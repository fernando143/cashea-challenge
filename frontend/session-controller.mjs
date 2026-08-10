export function createSessionController({ api, view, interactionLock, onSessionChanging, onLogout }) {
  const state = { token: null, user: null, currency: null };
  let revision = 0;
  let pending = 0;

  function setBusy(busy) {
    pending += busy ? 1 : -1;
    view.setBusy("login", pending > 0);
  }

  function reset() {
    state.token = null;
    state.user = null;
    state.currency = null;
    view.resetSession();
  }

  async function login(credentials) {
    if (interactionLock.isLocked()) return;
    const user = String(credentials.email ?? "").trim().toLowerCase();
    onSessionChanging(user);
    const requestRevision = ++revision;
    reset();
    view.clearError();
    setBusy(true);
    try {
      const { token } = await api.login(credentials);
      const credit = await api.getCreditLine(token);
      if (requestRevision !== revision) return;
      state.token = token;
      state.user = user;
      state.currency = credit.currency;
      view.activateSession(credit);
      view.setStatus("Ready to simulate a purchase.");
    } catch (cause) {
      if (requestRevision === revision) view.showError(cause instanceof Error ? cause.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    if (interactionLock.isLocked()) return;
    revision += 1;
    onLogout();
    reset();
    view.clearError();
  }

  return { login, logout, getSession: () => ({ ...state }) };
}
