import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindCheckout, createDomView } from "../../frontend/dom.mjs";
import { createMoneyFormatter } from "../../frontend/format-money.mjs";

beforeEach(() => {
  globalThis.document.body.innerHTML = `
    <output id="status"></output><a id="created-purchase-link" href="#purchase-details" hidden>View purchase</a><p id="error"></p>
    <form id="login-form"><input id="email" value="demo@cashea.local"><input id="password" value="secret"><button></button></form>
    <section id="checkout" hidden><strong id="available"></strong><strong id="limit"></strong><button id="logout-button"></button>
      <form id="purchase-lookup-form"><input id="purchase-id" value="purchase-1"><button id="purchase-lookup-button"></button></form>
      <section id="purchase-details" hidden><strong id="purchase-detail-id"></strong><strong id="purchase-detail-amount"></strong><strong id="purchase-detail-status"></strong><strong id="purchase-detail-created-at"></strong><strong id="purchase-detail-payment-method"></strong><table><tbody id="purchase-plan-rows"><tr><td><button type="button" data-installment-id="installment-2">Pay installment</button></td></tr></tbody></table></section>
      <form id="purchase-form"><input id="amount" value="3000"><select id="installments"><option value="3">3</option></select><button id="preview-button"></button></form>
      <section id="preview" hidden><table><tbody id="plan-rows"></tbody></table><button id="confirm-button"></button></section>
    </section>`;
});

describe("checkout DOM adapter", () => {
  it("formats API cents only when rendering and never interprets API text as markup", () => {
    const view = createDomView(globalThis.document, createMoneyFormatter("en-US"));
    view.setBusy("login", true);
    view.setStatus("Loading");
    view.showError("Temporary error");
    view.clearError();
    view.activateSession({ available: 12_345, creditLimit: 50_000, currency: "USD" });
    view.renderPreview(
      {
        plan: [{ number: 1, amount: 1_000, dueDate: "<img src=x onerror=alert(1)>" }],
      },
      "USD",
    );
    view.renderPurchase({
      id: "<img src=x onerror=alert(1)>", amount: 3_000, status: "pending", createdAt: "2026-08-10T12:00:00.000Z",
      paymentMethod: { brand: "Visa", last4: "4242" },
      plan: [
        { id: "installment-1", number: 1, amount: 1_000, dueDate: "2026-08-10", status: "paid", paidAt: "2026-08-10T12:00:00.000Z" },
        { id: "installment-2", number: 2, amount: 1_000, dueDate: "2026-09-09", status: "pending", paidAt: null },
      ],
    }, "USD");
    view.showPurchaseLink("purchase-1");

    expect(globalThis.document.getElementById("available").textContent).toBe("$123.45");
    expect(globalThis.document.getElementById("limit").textContent).toBe("$500.00");
    expect(globalThis.document.querySelector("#plan-rows tr").textContent).toContain("$10.00");
    expect(globalThis.document.querySelector("#plan-rows img")).toBeNull();
    expect(globalThis.document.getElementById("purchase-detail-amount").textContent).toBe("$30.00");
    expect(globalThis.document.getElementById("purchase-detail-payment-method").textContent).toBe("Visa •••• 4242");
    expect(globalThis.document.querySelector("#purchase-details img")).toBeNull();
    expect(globalThis.document.querySelectorAll("#purchase-plan-rows button")).toHaveLength(1);
    expect(globalThis.document.querySelector("#purchase-plan-rows button").dataset.installmentId).toBe("installment-2");
    expect(globalThis.document.getElementById("created-purchase-link").hidden).toBe(false);
    expect(globalThis.document.querySelector("#login-form button").disabled).toBe(true);
    expect(globalThis.document.getElementById("error").textContent).toBe("");

    view.clearPreview();
    view.resetSession();
    expect(globalThis.document.getElementById("checkout").hidden).toBe(true);
    expect(globalThis.document.getElementById("plan-rows").children).toHaveLength(0);
    expect(globalThis.document.getElementById("created-purchase-link").hidden).toBe(true);
  });

  it("binds forms and invalidates purchase intent as soon as inputs change", async () => {
    const controller = {
      login: vi.fn(),
      logout: vi.fn(),
      previewPurchase: vi.fn(),
      confirmPurchase: vi.fn(),
      lookupPurchase: vi.fn(),
      payInstallment: vi.fn(),
      invalidatePurchaseIntent: vi.fn(),
    };
    const view = createDomView(globalThis.document, createMoneyFormatter("en-US"));
    view.showPurchaseLink("created-purchase-1");
    bindCheckout(globalThis.document, controller);

    globalThis.document.getElementById("amount").dispatchEvent(new globalThis.Event("input"));
    globalThis.document.getElementById("installments").dispatchEvent(new globalThis.Event("change"));
    globalThis.document.getElementById("login-form").dispatchEvent(new globalThis.Event("submit"));
    globalThis.document.getElementById("purchase-form").dispatchEvent(new globalThis.Event("submit"));
    globalThis.document.getElementById("purchase-lookup-form").dispatchEvent(new globalThis.Event("submit"));
    globalThis.document.getElementById("created-purchase-link").click();
    globalThis.document.querySelector("#purchase-plan-rows button").click();
    globalThis.document.getElementById("confirm-button").click();
    globalThis.document.getElementById("logout-button").click();
    await Promise.resolve();

    expect(controller.invalidatePurchaseIntent).toHaveBeenCalledTimes(2);
    expect(controller.login).toHaveBeenCalledWith({ email: "demo@cashea.local", password: "secret" });
    expect(controller.previewPurchase).toHaveBeenCalledWith({ amount: "3000", installments: "3" });
    expect(controller.confirmPurchase).toHaveBeenCalledOnce();
    expect(controller.lookupPurchase).toHaveBeenCalledWith("purchase-1");
    expect(controller.lookupPurchase).toHaveBeenCalledWith("created-purchase-1");
    expect(globalThis.document.getElementById("purchase-id").value).toBe("created-purchase-1");
    expect(controller.payInstallment).toHaveBeenCalledWith("installment-2");
    expect(controller.logout).toHaveBeenCalledOnce();
  });

  it("locks every checkout transition while a confirmation is in flight", () => {
    const view = createDomView(globalThis.document, createMoneyFormatter("en-US"));

    view.setInteractionLocked(true);

    for (const element of globalThis.document.querySelectorAll("button, input, select")) {
      expect(element.disabled).toBe(true);
    }

    view.setInteractionLocked(false);
    for (const element of globalThis.document.querySelectorAll("button, input, select")) {
      expect(element.disabled).toBe(false);
    }
  });
});
