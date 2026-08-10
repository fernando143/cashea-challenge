import { ApiError } from "./api-client.mjs";

export const MAX_AMOUNT_CENTS = 99_999_999;

export function parsePurchaseInput({ amount, installments }) {
  const parsedAmount = Number(amount);
  const parsedInstallments = Number(installments);
  if (!Number.isSafeInteger(parsedAmount) || parsedAmount < 1 || parsedAmount > MAX_AMOUNT_CENTS) {
    throw new ApiError(`Amount must be an integer between 1 and ${MAX_AMOUNT_CENTS} cents.`, {
      status: 400,
      code: "INVALID_AMOUNT",
    });
  }
  if (!Number.isInteger(parsedInstallments)) {
    throw new ApiError("Installments must be an integer.", { status: 400, code: "INVALID_INSTALLMENTS" });
  }
  return { amount: parsedAmount, installments: parsedInstallments };
}

export function createCheckoutController({ api, view, randomUUID = () => globalThis.crypto.randomUUID() }) {
  const state = {
    token: null,
    currency: null,
    preview: null,
    intent: null,
  };
  let sessionRevision = 0;
  let purchaseRevision = 0;
  const busyCount = { login: 0, preview: 0, confirm: 0 };

  function beginBusy(action) {
    busyCount[action] += 1;
    view.setBusy(action, true);
  }

  function endBusy(action) {
    busyCount[action] -= 1;
    view.setBusy(action, busyCount[action] > 0);
  }

  function clearPurchaseIntent() {
    purchaseRevision += 1;
    state.preview = null;
    state.intent = null;
    view.clearPreview();
  }

  function resetSession() {
    state.token = null;
    state.currency = null;
    clearPurchaseIntent();
    view.resetSession();
  }

  async function login(credentials) {
    const revision = ++sessionRevision;
    resetSession();
    view.clearError();
    beginBusy("login");
    try {
      const { token: candidateToken } = await api.login(credentials);
      const credit = await api.getCreditLine(candidateToken);
      if (revision !== sessionRevision) return;
      state.token = candidateToken;
      state.currency = credit.currency;
      view.activateSession(credit);
      view.setStatus("Ready to simulate a purchase.");
    } catch (cause) {
      if (revision === sessionRevision) {
        view.showError(cause instanceof Error ? cause.message : "Login failed");
      }
    } finally {
      endBusy("login");
    }
  }

  function invalidatePurchaseIntent() {
    clearPurchaseIntent();
  }

  async function previewPurchase(rawInput) {
    clearPurchaseIntent();
    const revision = purchaseRevision;
    const token = state.token;
    view.clearError();
    beginBusy("preview");
    try {
      if (!token) throw new ApiError("Log in before previewing a purchase.", { status: 401, code: "UNAUTHORIZED" });
      const input = parsePurchaseInput(rawInput);
      const preview = await api.previewPurchase(input, token);
      if (revision !== purchaseRevision || token !== state.token) return;
      state.preview = preview;
      state.intent = { ...input, idempotencyKey: randomUUID() };
      view.renderPreview(preview, state.currency);
    } catch (cause) {
      if (revision === purchaseRevision && token === state.token) {
        view.showError(cause instanceof Error ? cause.message : "Preview failed");
      }
    } finally {
      endBusy("preview");
    }
  }

  async function confirmPurchase() {
    if (!state.token || !state.intent) return;

    const intent = state.intent;
    const token = state.token;
    view.clearError();
    beginBusy("confirm");
    try {
      await api.createPurchase(
        { amount: intent.amount, installments: intent.installments },
        intent.idempotencyKey,
        token,
      );

      // The purchase is final at this point. Clear it before the independent
      // balance refresh so a refresh failure can never submit it again.
      if (state.intent === intent && state.token === token) {
        clearPurchaseIntent();
        view.setStatus("Purchase confirmed. Refreshing your balance…");
      }

      try {
        const credit = await api.getCreditLine(token);
        if (state.token === token) {
          state.currency = credit.currency;
          view.renderCredit(credit);
          view.setStatus("Purchase confirmed. Your balance was refreshed.");
        }
      } catch {
        if (state.token === token) {
          view.setStatus("Purchase confirmed, but the balance could not be refreshed.");
          view.showError("Refresh the page to see your latest balance.");
        }
      }
    } catch (cause) {
      if (state.token === token && state.intent === intent) {
        view.showError(cause instanceof Error ? cause.message : "Purchase failed");
      }
    } finally {
      endBusy("confirm");
    }
  }

  return {
    login,
    previewPurchase,
    confirmPurchase,
    invalidatePurchaseIntent,
    getState: () => ({ ...state, intent: state.intent && { ...state.intent } }),
  };
}
