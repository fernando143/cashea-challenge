import { ApiError } from "./api-client.mjs";

export const PAYMENT_INTENT_STORAGE_KEY = "cashea.checkout.payment-intent.v1";

function createPaymentIntentStore(storage) {
  const remove = () => storage.removeItem(PAYMENT_INTENT_STORAGE_KEY);
  return {
    read() {
      const value = storage.getItem(PAYMENT_INTENT_STORAGE_KEY);
      if (!value) return null;
      let record;
      try { record = JSON.parse(value); } catch { remove(); return null; }
      const valid = record?.version === 1 && typeof record.user === "string"
        && typeof record.purchaseId === "string" && record.purchaseId.length > 0
        && typeof record.installmentId === "string" && record.installmentId.length > 0
        && typeof record.idempotencyKey === "string" && record.idempotencyKey.length > 0;
      if (valid) return record;
      remove();
      return null;
    },
    write(record) { storage.setItem(PAYMENT_INTENT_STORAGE_KEY, JSON.stringify(record)); },
    remove,
  };
}

export function createPurchaseDetailsController({ api, view, getSession, interactionLock, randomUUID = () => globalThis.crypto.randomUUID(), storage = globalThis.localStorage }) {
  const paymentStore = createPaymentIntentStore(storage);
  const state = { purchase: null };
  let revision = 0;
  let pending = 0;

  function setBusy(busy) {
    pending += busy ? 1 : -1;
    view.setBusy("lookup", pending > 0);
  }
  function clearPurchase() {
    revision += 1;
    state.purchase = null;
    view.clearPurchase();
  }
  function removePaymentIntentSafely() {
    try {
      paymentStore.remove();
      return true;
    } catch {
      return false;
    }
  }
  function prepareSession(nextUser) {
    const { user } = getSession();
    const stored = paymentStore.read();
    if ((user && user !== nextUser) || (stored && stored.user !== nextUser)) paymentStore.remove();
    clearPurchase();
  }
  function reset() {
    try {
      paymentStore.remove();
    } finally {
      clearPurchase();
    }
  }
  async function lookupPurchase(rawPurchaseId) {
    if (interactionLock.isLocked()) return;
    const purchaseId = String(rawPurchaseId ?? "").trim();
    clearPurchase();
    const requestRevision = revision;
    view.clearError();
    if (!purchaseId) {
      view.showError("Enter a purchase ID.");
      return;
    }

    const session = getSession();
    setBusy(true);
    try {
      if (!session.token) throw new ApiError("Log in before viewing a purchase.", { status: 401, code: "UNAUTHORIZED" });
      const purchase = await api.getPurchase(purchaseId, session.token);
      if (requestRevision !== revision || session.token !== getSession().token) return;
      const stored = paymentStore.read();
      if (stored?.user === session.user && stored.purchaseId === purchase.id) {
        const intendedInstallment = purchase.plan.find((item) => item.id === stored.installmentId);
        if ((!intendedInstallment || intendedInstallment.status === "paid") && !removePaymentIntentSafely()) {
          view.showError("Purchase refreshed, but local payment retry state could not be cleared.");
        }
      }
      state.purchase = purchase;
      view.renderPurchase(purchase, session.currency);
    } catch (cause) {
      if (requestRevision === revision && session.token === getSession().token) {
        view.showError(cause instanceof Error ? cause.message : "Purchase lookup failed");
      }
    } finally {
      setBusy(false);
    }
  }
  async function payInstallment(rawInstallmentId) {
    if (interactionLock.isLocked()) return;
    const installmentId = String(rawInstallmentId ?? "").trim();
    const session = getSession();
    const purchase = state.purchase;
    const installment = purchase?.plan.find((item) => item.id === installmentId);
    if (!session.token || !purchase || !installment) {
      view.showError("Load a purchase before paying an installment.");
      return;
    }
    if (!interactionLock.acquire()) return;

    view.clearError();
    try {
      const stored = paymentStore.read();
      const matchesPayment = stored?.user === session.user
        && stored.purchaseId === purchase.id
        && stored.installmentId === installment.id;
      if (installment.status === "paid") {
        if (matchesPayment) paymentStore.remove();
        view.showError("Installment is already paid");
        return;
      }
      if (stored && !matchesPayment) {
        view.showError("Retry the pending installment payment before paying another installment.");
        return;
      }

      const idempotencyKey = matchesPayment ? stored.idempotencyKey : randomUUID();
      if (!matchesPayment) {
        paymentStore.write({
          version: 1,
          user: session.user,
          purchaseId: purchase.id,
          installmentId: installment.id,
          idempotencyKey,
        });
      }
      view.setStatus(`Paying installment ${installment.number}…`);

      let result;
      try {
        result = await api.payInstallment(purchase.id, installment.id, idempotencyKey, session.token);
      } catch (cause) {
        if (cause instanceof ApiError && cause.code === "ALREADY_PAID") {
          const intentCleared = removePaymentIntentSafely();
          try {
            const [refreshedPurchase, credit] = await Promise.all([
              api.getPurchase(purchase.id, session.token),
              api.getCreditLine(session.token),
            ]);
            if (state.purchase === purchase && session.token === getSession().token) {
              state.purchase = refreshedPurchase;
              view.renderPurchase(refreshedPurchase, session.currency);
              view.renderCredit(credit);
              view.setStatus("Installment was already paid. Purchase details were refreshed.");
              if (!intentCleared) view.showError("Local payment retry state could not be cleared.");
            }
            return;
          } catch {
            // Fall through to the original API error when reconciliation fails.
          }
        }
        const definitiveClientError = cause instanceof ApiError
          && cause.status >= 400 && cause.status < 500
          && cause.code !== "IDEMPOTENCY_IN_PROGRESS";
        const intentCleared = !definitiveClientError || removePaymentIntentSafely();
        if (state.purchase === purchase && session.token === getSession().token) {
          view.setStatus("Installment payment failed.");
          const message = cause instanceof Error ? cause.message : "Installment payment failed";
          view.showError(intentCleared ? message : `${message} Local payment retry state could not be cleared.`);
        }
        return;
      }

      if (state.purchase !== purchase || session.token !== getSession().token) return;
      const plan = purchase.plan.map((item) => item.id === result.installment.id ? result.installment : item);
      const updatedPurchase = {
        ...purchase,
        plan,
        status: plan.every((item) => item.status === "paid") ? "paid" : "pending",
      };
      state.purchase = updatedPurchase;
      view.renderPurchase(updatedPurchase, session.currency);
      view.renderAvailable(result.available, session.currency);
      view.setStatus(`Installment ${result.installment.number} paid. Your balance was refreshed.`);
      if (!removePaymentIntentSafely()) {
        view.showError("Payment succeeded, but local payment retry state could not be cleared.");
      }
    } finally {
      interactionLock.release();
    }
  }

  return { prepareSession, reset, lookupPurchase, payInstallment, getState: () => ({ ...state }) };
}
