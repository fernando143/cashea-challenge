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
    lookup: element("purchase-lookup-button"),
  };
  const logoutButton = element("logout-button");
  const inputs = {
    login: [...element("login-form").querySelectorAll("input")],
    purchase: [element("amount"), element("installments")],
    lookup: [element("purchase-id")],
  };
  const busyState = { login: false, preview: false, confirm: false, lookup: false };
  let interactionLocked = false;

  function updateDisabledState() {
    buttons.login.disabled = interactionLocked || busyState.login;
    buttons.preview.disabled = interactionLocked || busyState.preview;
    buttons.confirm.disabled = interactionLocked || busyState.confirm;
    buttons.lookup.disabled = interactionLocked || busyState.lookup;
    logoutButton.disabled = interactionLocked;
    for (const input of inputs.login) input.disabled = interactionLocked;
    for (const input of inputs.purchase) input.disabled = interactionLocked;
    for (const input of inputs.lookup) input.disabled = interactionLocked;
    for (const button of element("purchase-plan-rows").querySelectorAll("button")) button.disabled = interactionLocked;
  }

  function clearPreview() {
    element("preview").hidden = true;
    element("plan-rows").replaceChildren();
  }

  function renderAvailable(available, currency) {
    element("available").textContent = formatMoney(available, currency);
  }

  function renderCredit(credit) {
    renderAvailable(credit.available, credit.currency);
    element("limit").textContent = formatMoney(credit.creditLimit, credit.currency);
  }

  function clearPurchase() {
    element("purchase-details").hidden = true;
    element("purchase-plan-rows").replaceChildren();
  }

  function clearPurchaseLink() {
    const link = element("created-purchase-link");
    link.hidden = true;
    delete link.dataset.purchaseId;
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
      clearPurchaseLink();
      clearPurchase();
    },
    activateSession(credit) {
      renderCredit(credit);
      element("checkout").hidden = false;
    },
    renderCredit,
    renderAvailable,
    clearPreview,
    clearPurchase,
    showPurchaseLink(purchaseId) {
      const link = element("created-purchase-link");
      link.dataset.purchaseId = purchaseId;
      link.hidden = false;
    },
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
    renderPurchase(purchase, currency) {
      element("purchase-detail-id").textContent = purchase.id;
      element("purchase-detail-amount").textContent = formatMoney(purchase.amount, currency);
      element("purchase-detail-status").textContent = purchase.status;
      element("purchase-detail-created-at").textContent = purchase.createdAt;
      element("purchase-detail-payment-method").textContent = `${purchase.paymentMethod.brand} •••• ${purchase.paymentMethod.last4}`;
      const rows = purchase.plan.map((item) => {
        const row = document.createElement("tr");
        for (const value of [item.number, formatMoney(item.amount, currency), item.dueDate, item.status, item.paidAt ?? "—"]) {
          const cell = document.createElement("td");
          cell.textContent = String(value);
          row.append(cell);
        }
        const action = document.createElement("td");
        if (item.status === "pending") {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.installmentId = item.id;
          button.textContent = "Pay installment";
          action.append(button);
        } else {
          action.textContent = "Paid";
        }
        row.append(action);
        return row;
      });
      element("purchase-plan-rows").replaceChildren(...rows);
      element("purchase-details").hidden = false;
      updateDisabledState();
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

  element("purchase-lookup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void controller.lookupPurchase(element("purchase-id").value);
  });

  element("created-purchase-link").addEventListener("click", (event) => {
    event.preventDefault();
    const purchaseId = event.currentTarget.dataset.purchaseId;
    if (!purchaseId) return;
    element("purchase-id").value = purchaseId;
    void controller.lookupPurchase(purchaseId);
  });

  element("purchase-plan-rows").addEventListener("click", (event) => {
    const button = event.target.closest?.("button[data-installment-id]");
    if (button) void controller.payInstallment(button.dataset.installmentId);
  });

  element("amount").addEventListener("input", controller.invalidatePurchaseIntent);
  element("installments").addEventListener("change", controller.invalidatePurchaseIntent);
  element("confirm-button").addEventListener("click", () => void controller.confirmPurchase());
  element("logout-button").addEventListener("click", controller.logout);
}
