export function createDomView(document, formatMoney) {
  const element = (id) => {
    const value = document.getElementById(id);
    if (!value) throw new Error(`Missing #${id}`);
    return value;
  };

  const buttons = {
    login: element("login-form").querySelector("button"),
    preview: element("preview-button"),
    confirm: element("confirm-button"),
  };
  const logoutButton = element("logout-button");
  const inputs = {
    login: [...element("login-form").querySelectorAll("input")],
    purchase: [element("amount"), element("installments")],
  };
  const busyState = { login: false, preview: false, confirm: false };
  let interactionLocked = false;

  function updateDisabledState() {
    buttons.login.disabled = interactionLocked || busyState.login;
    buttons.preview.disabled = interactionLocked || busyState.preview;
    buttons.confirm.disabled = interactionLocked || busyState.confirm;
    logoutButton.disabled = interactionLocked;
    for (const input of inputs.login) input.disabled = interactionLocked;
    for (const input of inputs.purchase) input.disabled = interactionLocked;
  }

  function clearPreview() {
    element("preview").hidden = true;
    element("plan-rows").replaceChildren();
  }

  function renderCredit(credit) {
    element("available").textContent = formatMoney(credit.available, credit.currency);
    element("limit").textContent = formatMoney(credit.creditLimit, credit.currency);
  }

  return {
    setBusy(action, busy) {
      busyState[action] = busy;
      updateDisabledState();
    },
    setInteractionLocked(locked) {
      interactionLocked = locked;
      updateDisabledState();
    },
    setStatus(message) {
      element("status").textContent = message;
    },
    clearError() {
      element("error").textContent = "";
    },
    showError(message) {
      element("error").textContent = message;
    },
    resetSession() {
      element("checkout").hidden = true;
      element("available").textContent = "—";
      element("limit").textContent = "—";
      element("status").textContent = "Log in to view your credit line.";
    },
    activateSession(credit) {
      renderCredit(credit);
      element("checkout").hidden = false;
    },
    renderCredit,
    clearPreview,
    renderPreview(preview, currency) {
      const rows = preview.plan.map((item) => {
        const row = document.createElement("tr");
        for (const value of [item.number, formatMoney(item.amount, currency), item.dueDate]) {
          const cell = document.createElement("td");
          cell.textContent = String(value);
          row.append(cell);
        }
        return row;
      });
      element("plan-rows").replaceChildren(...rows);
      element("preview").hidden = false;
    },
  };
}

export function bindCheckout(document, controller) {
  const element = (id) => document.getElementById(id);

  element("login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void controller.login({ email: element("email").value, password: element("password").value });
  });

  element("purchase-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void controller.previewPurchase({
      amount: element("amount").value,
      installments: element("installments").value,
    });
  });

  element("amount").addEventListener("input", controller.invalidatePurchaseIntent);
  element("installments").addEventListener("change", controller.invalidatePurchaseIntent);
  element("confirm-button").addEventListener("click", () => void controller.confirmPurchase());
  element("logout-button").addEventListener("click", controller.logout);
}
