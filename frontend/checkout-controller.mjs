import { ApiError } from "./api-client.mjs";

export const MAX_AMOUNT_CENTS = 99_999_999;
export const PURCHASE_INTENT_STORAGE_KEY = "cashea.checkout.purchase-intent.v1";

export function parsePurchaseInput({ amount, installments }) {
  const parsedAmount = Number(amount);
  const parsedInstallments = Number(installments);
  if (!Number.isSafeInteger(parsedAmount) || parsedAmount < 1 || parsedAmount > MAX_AMOUNT_CENTS) {
    throw new ApiError(`Amount must be an integer between 1 and ${MAX_AMOUNT_CENTS} cents.`, { status: 400, code: "INVALID_AMOUNT" });
  }
  if (!Number.isInteger(parsedInstallments)) throw new ApiError("Installments must be an integer.", { status: 400, code: "INVALID_INSTALLMENTS" });
  return { amount: parsedAmount, installments: parsedInstallments };
}

function fingerprint(request) { return JSON.stringify(request); }

function createIntentStore(storage) {
  const remove = () => storage.removeItem(PURCHASE_INTENT_STORAGE_KEY);
  return {
    read() {
      const value = storage.getItem(PURCHASE_INTENT_STORAGE_KEY);
      if (!value) return null;
      let record;
      try { record = JSON.parse(value); } catch { remove(); return null; }
      const valid = record?.version === 1 && typeof record.user === "string"
        && typeof record.idempotencyKey === "string" && record.idempotencyKey.length > 0
        && Number.isSafeInteger(record.request?.amount) && Number.isInteger(record.request?.installments)
        && record.fingerprint === fingerprint(record.request);
      if (valid) return record;
      remove();
      return null;
    },
    write(record) { storage.setItem(PURCHASE_INTENT_STORAGE_KEY, JSON.stringify(record)); },
    remove,
  };
}

export function createCheckoutController({ api, view, getSession, interactionLock, randomUUID = () => globalThis.crypto.randomUUID(), storage = globalThis.localStorage }) {
  const store = createIntentStore(storage);
  const state = { preview: null, intent: null };
  let revision = 0;
  let previewPending = 0;

  function setPreviewBusy(busy) {
    previewPending += busy ? 1 : -1;
    view.setBusy("preview", previewPending > 0);
  }
  function clearPreview() { revision += 1; state.preview = null; view.clearPreview(); }
  function clearPurchaseIntent({ persisted = true } = {}) {
    clearPreview();
    state.intent = null;
    if (persisted) store.remove();
  }
  function prepareSession(nextUser) {
    const { user } = getSession();
    const stored = store.read();
    if ((user && user !== nextUser) || (stored && stored.user !== nextUser)) store.remove();
    clearPurchaseIntent({ persisted: false });
  }
  function invalidatePurchaseIntent() {
    if (!interactionLock.isLocked()) clearPurchaseIntent();
  }
  async function previewPurchase(rawInput) {
    if (interactionLock.isLocked()) return;
    let input;
    try { input = parsePurchaseInput(rawInput); } catch (cause) {
      clearPurchaseIntent();
      view.showError(cause instanceof Error ? cause.message : "Preview failed");
      return;
    }
    const requestFingerprint = fingerprint(input);
    if (state.intent && state.intent.fingerprint !== requestFingerprint) clearPurchaseIntent();
    const session = getSession();
    const stored = store.read();
    if (stored && (stored.user !== session.user || stored.fingerprint !== requestFingerprint)) store.remove();
    clearPreview();
    const requestRevision = revision;
    view.clearError();
    setPreviewBusy(true);
    let preview;
    try {
      if (!session.token) throw new ApiError("Log in before previewing a purchase.", { status: 401, code: "UNAUTHORIZED" });
      preview = await api.previewPurchase(input, session.token);
      if (requestRevision !== revision || session.token !== getSession().token) return;
    } catch (cause) {
      if (requestRevision === revision && session.token === getSession().token) view.showError(cause instanceof Error ? cause.message : "Preview failed");
      return;
    } finally { setPreviewBusy(false); }
    const reusable = state.intent?.fingerprint === requestFingerprint ? state.intent : (() => {
      const current = store.read();
      if (current?.user === session.user && current.fingerprint === requestFingerprint) return { ...current.request, fingerprint: requestFingerprint, idempotencyKey: current.idempotencyKey };
      const idempotencyKey = randomUUID();
      store.write({ version: 1, user: session.user, request: input, fingerprint: requestFingerprint, idempotencyKey });
      return { ...input, fingerprint: requestFingerprint, idempotencyKey };
    })();
    state.preview = preview;
    state.intent = reusable;
    view.renderPreview(preview, session.currency);
  }
  async function confirmPurchase() {
    const session = getSession();
    if (!session.token || !state.intent || !interactionLock.acquire()) return;
    const intent = state.intent;
    view.clearError();
    view.setBusy("confirm", true);
    try {
      let created;
      try { created = await api.createPurchase({ amount: intent.amount, installments: intent.installments }, intent.idempotencyKey, session.token); }
      catch (cause) { if (state.intent === intent) view.showError(cause instanceof Error ? cause.message : "Purchase failed"); return; }
      if (state.intent === intent && session.token === getSession().token) {
        clearPurchaseIntent();
        if (typeof created?.purchase?.id === "string") view.showPurchaseLink(created.purchase.id);
        view.setStatus("Purchase confirmed. Refreshing your balance…");
      }
      try {
        const credit = await api.getCreditLine(session.token);
        if (session.token === getSession().token) {
          view.renderCredit(credit);
          view.setStatus("Purchase confirmed. Your balance was refreshed.");
        }
      } catch {
        if (session.token === getSession().token) {
          view.setStatus("Purchase confirmed, but the balance could not be refreshed.");
          view.showError("Refresh the page to see your latest balance.");
        }
      }
    } finally {
      view.setBusy("confirm", false);
      interactionLock.release();
    }
  }
  return { prepareSession, clearPurchaseIntent, invalidatePurchaseIntent, previewPurchase, confirmPurchase, getState: () => ({ ...state, intent: state.intent && { ...state.intent } }) };
}
