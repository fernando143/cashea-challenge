import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindCheckout, createDomView } from "../../frontend/dom.mjs";
import { createMoneyFormatter } from "../../frontend/format-money.mjs";

beforeEach(() => {
  globalThis.document.body.innerHTML = `
    <output id="status"></output><p id="error"></p>
    <form id="login-form"><input id="email" value="demo@cashea.local"><input id="password" value="secret"><button></button></form>
    <section id="checkout" hidden><strong id="available"></strong><strong id="limit"></strong><button id="logout-button"></button>
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

    expect(globalThis.document.getElementById("available").textContent).toBe("$123.45");
    expect(globalThis.document.getElementById("limit").textContent).toBe("$500.00");
    expect(globalThis.document.querySelector("#plan-rows tr").textContent).toContain("$10.00");
    expect(globalThis.document.querySelector("#plan-rows img")).toBeNull();
    expect(globalThis.document.querySelector("#login-form button").disabled).toBe(true);
    expect(globalThis.document.getElementById("error").textContent).toBe("");

    view.clearPreview();
    view.resetSession();
    expect(globalThis.document.getElementById("checkout").hidden).toBe(true);
    expect(globalThis.document.getElementById("plan-rows").children).toHaveLength(0);
  });

  it("binds forms and invalidates purchase intent as soon as inputs change", async () => {
    const controller = {
      login: vi.fn(),
      logout: vi.fn(),
      previewPurchase: vi.fn(),
      confirmPurchase: vi.fn(),
      invalidatePurchaseIntent: vi.fn(),
    };
    bindCheckout(globalThis.document, controller);

    globalThis.document.getElementById("amount").dispatchEvent(new globalThis.Event("input"));
    globalThis.document.getElementById("installments").dispatchEvent(new globalThis.Event("change"));
    globalThis.document.getElementById("login-form").dispatchEvent(new globalThis.Event("submit"));
    globalThis.document.getElementById("purchase-form").dispatchEvent(new globalThis.Event("submit"));
    globalThis.document.getElementById("confirm-button").click();
    globalThis.document.getElementById("logout-button").click();
    await Promise.resolve();

    expect(controller.invalidatePurchaseIntent).toHaveBeenCalledTimes(2);
    expect(controller.login).toHaveBeenCalledWith({ email: "demo@cashea.local", password: "secret" });
    expect(controller.previewPurchase).toHaveBeenCalledWith({ amount: "3000", installments: "3" });
    expect(controller.confirmPurchase).toHaveBeenCalledOnce();
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
