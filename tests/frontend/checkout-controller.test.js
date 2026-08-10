import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../frontend/api-client.mjs";
import {
  MAX_AMOUNT_CENTS,
  createCheckoutController,
  parsePurchaseInput,
} from "../../frontend/checkout-controller.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createView() {
  return {
    setBusy: vi.fn(),
    setStatus: vi.fn(),
    clearError: vi.fn(),
    showError: vi.fn(),
    resetSession: vi.fn(),
    activateSession: vi.fn(),
    renderCredit: vi.fn(),
    clearPreview: vi.fn(),
    renderPreview: vi.fn(),
  };
}

function createApi() {
  return {
    login: vi.fn(),
    getCreditLine: vi.fn(),
    previewPurchase: vi.fn(),
    createPurchase: vi.fn(),
  };
}

const credit = { available: 90_000, creditLimit: 100_000, currency: "VES" };
const preview = {
  amount: 3_000,
  installments: 3,
  plan: [{ number: 1, amount: 1_000, dueDate: "2026-08-10" }],
};

async function login(controller, api, token = "token-1") {
  api.login.mockResolvedValueOnce({ token });
  api.getCreditLine.mockResolvedValueOnce(credit);
  await controller.login({ email: "demo@cashea.local", password: "secret" });
}

describe("checkout controller", () => {
  it("activates a candidate session only after its credit line loads", async () => {
    const api = createApi();
    const view = createView();
    const pendingCredit = deferred();
    api.login.mockResolvedValue({ token: "candidate-token" });
    api.getCreditLine.mockReturnValue(pendingCredit.promise);
    const controller = createCheckoutController({ api, view, randomUUID: () => "intent-1" });

    const pendingLogin = controller.login({ email: "new@user.test", password: "secret" });
    await vi.waitFor(() => expect(api.getCreditLine).toHaveBeenCalledWith("candidate-token"));

    expect(controller.getState().token).toBeNull();
    expect(view.activateSession).not.toHaveBeenCalled();

    pendingCredit.resolve(credit);
    await pendingLogin;

    expect(controller.getState()).toMatchObject({ token: "candidate-token", currency: "VES" });
    expect(view.activateSession).toHaveBeenCalledWith(credit);
  });

  it("clears the previous user's preview and intent before another login", async () => {
    const api = createApi();
    const view = createView();
    const controller = createCheckoutController({ api, view, randomUUID: () => "intent-1" });
    await login(controller, api);
    api.previewPurchase.mockResolvedValueOnce(preview);
    await controller.previewPurchase({ amount: "3000", installments: "3" });
    expect(controller.getState().intent).toBeTruthy();

    api.login.mockRejectedValueOnce(new ApiError("Invalid credentials", { status: 401 }));
    await controller.login({ email: "other@user.test", password: "wrong" });

    expect(controller.getState()).toMatchObject({ token: null, preview: null, intent: null });
    expect(view.resetSession).toHaveBeenCalledTimes(2);
  });

  it("reuses one idempotency key after an uncertain failure and clears it on success", async () => {
    const api = createApi();
    const view = createView();
    const controller = createCheckoutController({ api, view, randomUUID: () => "intent-1" });
    await login(controller, api);
    api.previewPurchase.mockResolvedValueOnce(preview);
    await controller.previewPurchase({ amount: "3000", installments: "3" });

    api.createPurchase.mockRejectedValueOnce(new ApiError("Try again", { code: "NETWORK_ERROR" }));
    await controller.confirmPurchase();
    expect(controller.getState().intent.idempotencyKey).toBe("intent-1");

    api.createPurchase.mockResolvedValueOnce({ purchase: { id: "purchase-1" } });
    api.getCreditLine.mockResolvedValueOnce({ ...credit, available: 88_000 });
    await controller.confirmPurchase();

    expect(api.createPurchase).toHaveBeenNthCalledWith(1, { amount: 3_000, installments: 3 }, "intent-1", "token-1");
    expect(api.createPurchase).toHaveBeenNthCalledWith(2, { amount: 3_000, installments: 3 }, "intent-1", "token-1");
    expect(controller.getState().intent).toBeNull();
    expect(view.renderCredit).toHaveBeenCalledWith({ ...credit, available: 88_000 });
  });

  it("never resubmits a confirmed purchase when the independent credit refresh fails", async () => {
    const api = createApi();
    const view = createView();
    const controller = createCheckoutController({ api, view, randomUUID: () => "intent-1" });
    await login(controller, api);
    api.previewPurchase.mockResolvedValueOnce(preview);
    await controller.previewPurchase({ amount: "3000", installments: "3" });
    api.createPurchase.mockResolvedValueOnce({ purchase: { id: "purchase-1" } });
    api.getCreditLine.mockRejectedValueOnce(new ApiError("Unavailable", { status: 503 }));

    await controller.confirmPurchase();
    await controller.confirmPurchase();

    expect(api.createPurchase).toHaveBeenCalledTimes(1);
    expect(controller.getState().intent).toBeNull();
    expect(view.setStatus).toHaveBeenCalledWith("Purchase confirmed, but the balance could not be refreshed.");
  });

  it("invalidates a preview when the form changes, including while preview is loading", async () => {
    const api = createApi();
    const view = createView();
    const pendingPreview = deferred();
    const controller = createCheckoutController({ api, view, randomUUID: () => "intent-1" });
    await login(controller, api);
    api.previewPurchase.mockReturnValueOnce(pendingPreview.promise);

    const request = controller.previewPurchase({ amount: "3000", installments: "3" });
    await vi.waitFor(() => expect(api.previewPurchase).toHaveBeenCalled());
    controller.invalidatePurchaseIntent();
    pendingPreview.resolve(preview);
    await request;

    expect(controller.getState()).toMatchObject({ preview: null, intent: null });
    expect(view.renderPreview).not.toHaveBeenCalled();
  });
});

describe("purchase input contract", () => {
  it("accepts only integer JSON cents within the public maximum", () => {
    expect(parsePurchaseInput({ amount: String(MAX_AMOUNT_CENTS), installments: "3" })).toEqual({
      amount: MAX_AMOUNT_CENTS,
      installments: 3,
    });
    for (const amount of ["0", "1.5", String(MAX_AMOUNT_CENTS + 1), "not-money"]) {
      expect(() => parsePurchaseInput({ amount, installments: "3" })).toThrowError(
        expect.objectContaining({ code: "INVALID_AMOUNT" }),
      );
    }
  });
});
