import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../frontend/api-client.mjs";
import {
  MAX_AMOUNT_CENTS,
  PURCHASE_INTENT_STORAGE_KEY,
  parsePurchaseInput,
} from "../../frontend/checkout-controller.mjs";
import { createCheckoutPageController } from "../../frontend/checkout-page-controller.mjs";
import { PAYMENT_INTENT_STORAGE_KEY } from "../../frontend/purchase-details-controller.mjs";

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
    renderAvailable: vi.fn(),
    clearPreview: vi.fn(),
    renderPreview: vi.fn(),
    clearPurchase: vi.fn(),
    renderPurchase: vi.fn(),
    showPurchaseLink: vi.fn(),
    setInteractionLocked: vi.fn(),
  };
}

function createStorage() {
  const values = new Map();
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    removeItem: vi.fn((key) => values.delete(key)),
  };
}

function createApi() {
  return {
    login: vi.fn(),
    getCreditLine: vi.fn(),
    previewPurchase: vi.fn(),
    createPurchase: vi.fn(),
    getPurchase: vi.fn(),
    payInstallment: vi.fn(),
  };
}

const credit = { available: 90_000, creditLimit: 100_000, currency: "VES" };
const preview = {
  amount: 3_000,
  installments: 3,
  plan: [{ number: 1, amount: 1_000, dueDate: "2026-08-10" }],
};
const purchase = {
  id: "a3f4d5e6-7890-4abc-8def-1234567890ab",
  amount: 3_000,
  installments: 3,
  status: "pending",
  createdAt: "2026-08-10T12:00:00.000Z",
  paymentMethod: { brand: "Visa", last4: "4242" },
  plan: [
    { id: "installment-1", number: 1, amount: 1_000, dueDate: "2026-08-10", status: "paid", paidAt: "2026-08-10T12:00:00.000Z" },
    { id: "installment-2", number: 2, amount: 1_000, dueDate: "2026-09-09", status: "pending", paidAt: null },
  ],
};

async function login(controller, api, token = "token-1") {
  api.login.mockResolvedValueOnce({ token });
  api.getCreditLine.mockResolvedValueOnce(credit);
  await controller.login({ email: "demo@cashea.local", password: "secret" });
}

describe("checkout controller", () => {
  it("loads a purchase by ID and renders it with the session currency", async () => {
    const api = createApi();
    const view = createView();
    const controller = createCheckoutPageController({ api, view });
    await login(controller, api);
    api.getPurchase.mockResolvedValueOnce(purchase);

    await controller.lookupPurchase(` ${purchase.id} `);

    expect(api.getPurchase).toHaveBeenCalledWith(purchase.id, "token-1");
    expect(controller.getState().purchase).toEqual(purchase);
    expect(view.renderPurchase).toHaveBeenCalledWith(purchase, "VES");
  });

  it("keeps only the latest purchase lookup result", async () => {
    const api = createApi();
    const view = createView();
    const first = deferred();
    const newerPurchase = { ...purchase, id: "b3f4d5e6-7890-4abc-8def-1234567890ab" };
    const controller = createCheckoutPageController({ api, view });
    await login(controller, api);
    api.getPurchase.mockReturnValueOnce(first.promise).mockResolvedValueOnce(newerPurchase);

    const firstLookup = controller.lookupPurchase(purchase.id);
    await vi.waitFor(() => expect(api.getPurchase).toHaveBeenCalledOnce());
    await controller.lookupPurchase(newerPurchase.id);
    first.resolve(purchase);
    await firstLookup;

    expect(controller.getState().purchase).toEqual(newerPurchase);
    expect(view.renderPurchase).toHaveBeenCalledTimes(1);
    expect(view.renderPurchase).toHaveBeenCalledWith(newerPurchase, "VES");
  });

  it("discards an in-flight purchase lookup when the user logs out", async () => {
    const api = createApi();
    const view = createView();
    const pendingPurchase = deferred();
    const controller = createCheckoutPageController({ api, view });
    await login(controller, api);
    api.getPurchase.mockReturnValueOnce(pendingPurchase.promise);

    const lookup = controller.lookupPurchase(purchase.id);
    await vi.waitFor(() => expect(api.getPurchase).toHaveBeenCalledOnce());
    controller.logout();
    pendingPurchase.resolve(purchase);
    await lookup;

    expect(controller.getState().purchase).toBeNull();
    expect(view.renderPurchase).not.toHaveBeenCalled();
  });

  it("clears an uncertain payment intent once a refreshed purchase shows it paid", async () => {
    const storage = createStorage();
    storage.setItem(PAYMENT_INTENT_STORAGE_KEY, JSON.stringify({
      version: 1,
      user: "demo@cashea.local",
      purchaseId: purchase.id,
      installmentId: "installment-2",
      idempotencyKey: "payment-intent-1",
    }));
    const api = createApi();
    const controller = createCheckoutPageController({ api, view: createView(), storage });
    await login(controller, api);
    api.getPurchase.mockResolvedValueOnce({
      ...purchase,
      status: "paid",
      plan: purchase.plan.map((item) => item.id === "installment-2" ? { ...item, status: "paid" } : item),
    });

    await controller.lookupPurchase(purchase.id);

    expect(storage.getItem(PAYMENT_INTENT_STORAGE_KEY)).toBeNull();
  });

  it("reuses the payment key after an uncertain failure and updates the purchase on success", async () => {
    const storage = createStorage();
    const api = createApi();
    const view = createView();
    const controller = createCheckoutPageController({ api, view, randomUUID: () => "payment-intent-1", storage });
    await login(controller, api);
    api.getPurchase.mockResolvedValueOnce(purchase);
    await controller.lookupPurchase(purchase.id);

    api.payInstallment.mockRejectedValueOnce(new ApiError("Try again", { code: "NETWORK_ERROR" }));
    await controller.payInstallment("installment-2");
    expect(JSON.parse(storage.getItem(PAYMENT_INTENT_STORAGE_KEY))).toMatchObject({
      purchaseId: purchase.id,
      installmentId: "installment-2",
      idempotencyKey: "payment-intent-1",
    });

    const paidInstallment = { ...purchase.plan[1], status: "paid", paidAt: "2026-08-10T13:00:00.000Z" };
    api.payInstallment.mockResolvedValueOnce({ installment: paidInstallment, available: 91_000 });
    await controller.payInstallment("installment-2");

    expect(api.payInstallment).toHaveBeenNthCalledWith(1, purchase.id, "installment-2", "payment-intent-1", "token-1");
    expect(api.payInstallment).toHaveBeenNthCalledWith(2, purchase.id, "installment-2", "payment-intent-1", "token-1");
    expect(storage.getItem(PAYMENT_INTENT_STORAGE_KEY)).toBeNull();
    expect(controller.getState().purchase).toMatchObject({ status: "paid", plan: [purchase.plan[0], paidInstallment] });
    expect(view.renderAvailable).toHaveBeenCalledWith(91_000, "VES");
  });

  it("keeps the payment key after a server failure", async () => {
    const storage = createStorage();
    const api = createApi();
    const controller = createCheckoutPageController({ api, view: createView(), randomUUID: () => "payment-intent-1", storage });
    await login(controller, api);
    api.getPurchase.mockResolvedValueOnce(purchase);
    await controller.lookupPurchase(purchase.id);
    api.payInstallment.mockRejectedValueOnce(new ApiError("Unavailable", { status: 503, code: "INTERNAL_ERROR" }));

    await controller.payInstallment("installment-2");

    expect(JSON.parse(storage.getItem(PAYMENT_INTENT_STORAGE_KEY))).toMatchObject({
      installmentId: "installment-2",
      idempotencyKey: "payment-intent-1",
    });
  });

  it("updates the UI after payment success even when retry-state cleanup fails", async () => {
    const storage = createStorage();
    const api = createApi();
    const view = createView();
    const controller = createCheckoutPageController({ api, view, randomUUID: () => "payment-intent-1", storage });
    await login(controller, api);
    api.getPurchase.mockResolvedValueOnce(purchase);
    await controller.lookupPurchase(purchase.id);
    const paidInstallment = { ...purchase.plan[1], status: "paid", paidAt: "2026-08-10T13:00:00.000Z" };
    api.payInstallment.mockResolvedValueOnce({ installment: paidInstallment, available: 91_000 });
    storage.removeItem.mockImplementation((key) => {
      if (key === PAYMENT_INTENT_STORAGE_KEY) throw new Error("storage removal failed");
    });

    await controller.payInstallment("installment-2");

    expect(controller.getState().purchase).toMatchObject({ status: "paid" });
    expect(view.renderAvailable).toHaveBeenCalledWith(91_000, "VES");
    expect(view.showError).toHaveBeenCalledWith("Payment succeeded, but local payment retry state could not be cleared.");
  });

  it("refreshes stale purchase and credit state when the installment is already paid", async () => {
    const storage = createStorage();
    const api = createApi();
    const view = createView();
    const controller = createCheckoutPageController({ api, view, randomUUID: () => "payment-intent-1", storage });
    await login(controller, api);
    api.getPurchase.mockResolvedValueOnce(purchase);
    await controller.lookupPurchase(purchase.id);
    const refreshedPurchase = {
      ...purchase,
      status: "paid",
      plan: purchase.plan.map((item) => item.id === "installment-2" ? { ...item, status: "paid" } : item),
    };
    api.payInstallment.mockRejectedValueOnce(new ApiError("Installment is already paid", { status: 409, code: "ALREADY_PAID" }));
    api.getPurchase.mockResolvedValueOnce(refreshedPurchase);
    api.getCreditLine.mockResolvedValueOnce({ ...credit, available: 91_000 });

    await controller.payInstallment("installment-2");

    expect(controller.getState().purchase).toEqual(refreshedPurchase);
    expect(view.renderCredit).toHaveBeenCalledWith({ ...credit, available: 91_000 });
    expect(view.setStatus).toHaveBeenCalledWith("Installment was already paid. Purchase details were refreshed.");
    expect(storage.getItem(PAYMENT_INTENT_STORAGE_KEY)).toBeNull();
  });

  it("resets the session even when payment-intent cleanup fails during logout", async () => {
    const storage = createStorage();
    const api = createApi();
    const view = createView();
    const controller = createCheckoutPageController({ api, view, storage });
    await login(controller, api);
    storage.removeItem.mockImplementation((key) => {
      if (key === PAYMENT_INTENT_STORAGE_KEY) throw new Error("storage removal failed");
    });

    expect(() => controller.logout()).toThrow("storage removal failed");

    expect(controller.getState()).toMatchObject({ token: null, user: null, purchase: null });
    expect(view.resetSession).toHaveBeenCalledTimes(2);
  });

  it("blocks duplicate installment payments and session transitions while payment is in flight", async () => {
    const api = createApi();
    const view = createView();
    const pendingPayment = deferred();
    const controller = createCheckoutPageController({ api, view, randomUUID: () => "payment-intent-1", storage: createStorage() });
    await login(controller, api);
    api.getPurchase.mockResolvedValueOnce(purchase);
    await controller.lookupPurchase(purchase.id);
    api.payInstallment.mockReturnValueOnce(pendingPayment.promise);

    const payment = controller.payInstallment("installment-2");
    await vi.waitFor(() => expect(api.payInstallment).toHaveBeenCalledOnce());
    await controller.payInstallment("installment-2");
    controller.logout();

    expect(api.payInstallment).toHaveBeenCalledOnce();
    expect(controller.getState().token).toBe("token-1");
    pendingPayment.resolve({ installment: { ...purchase.plan[1], status: "paid", paidAt: "2026-08-10T13:00:00.000Z" }, available: 91_000 });
    await payment;
    expect(view.setInteractionLocked).toHaveBeenLastCalledWith(false);
  });

  it("activates a candidate session only after its credit line loads", async () => {
    const api = createApi();
    const view = createView();
    const pendingCredit = deferred();
    api.login.mockResolvedValue({ token: "candidate-token" });
    api.getCreditLine.mockReturnValue(pendingCredit.promise);
    const controller = createCheckoutPageController({ api, view, randomUUID: () => "intent-1" });

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
    const storage = createStorage();
    const controller = createCheckoutPageController({ api, view, randomUUID: () => "intent-1", storage });
    await login(controller, api);
    api.previewPurchase.mockResolvedValueOnce(preview);
    await controller.previewPurchase({ amount: "3000", installments: "3" });
    expect(controller.getState().intent).toBeTruthy();

    api.login.mockRejectedValueOnce(new ApiError("Invalid credentials", { status: 401 }));
    await controller.login({ email: "other@user.test", password: "wrong" });

    expect(controller.getState()).toMatchObject({ token: null, preview: null, intent: null });
    expect(storage.getItem(PURCHASE_INTENT_STORAGE_KEY)).toBeNull();
    expect(view.resetSession).toHaveBeenCalledTimes(2);
  });

  it("reuses one idempotency key after an uncertain failure and clears it on success", async () => {
    const api = createApi();
    const view = createView();
    const controller = createCheckoutPageController({ api, view, randomUUID: () => "intent-1" });
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
    expect(view.showPurchaseLink).toHaveBeenCalledWith("purchase-1");
  });

  it("restores the same normalized intent after recreating the controller", async () => {
    const storage = createStorage();
    const firstApi = createApi();
    const firstController = createCheckoutPageController({
      api: firstApi,
      view: createView(),
      randomUUID: () => "intent-1",
      storage,
    });
    await login(firstController, firstApi);
    firstApi.previewPurchase.mockResolvedValueOnce(preview);
    await firstController.previewPurchase({ amount: "03000", installments: "3" });

    const nextApi = createApi();
    const nextUUID = vi.fn(() => "intent-2");
    const nextController = createCheckoutPageController({ api: nextApi, view: createView(), randomUUID: nextUUID, storage });
    await login(nextController, nextApi);
    nextApi.previewPurchase.mockResolvedValueOnce(preview);
    await nextController.previewPurchase({ amount: "3000", installments: "03" });

    expect(nextController.getState().intent).toMatchObject({
      amount: 3_000,
      installments: 3,
      idempotencyKey: "intent-1",
    });
    expect(nextUUID).not.toHaveBeenCalled();
  });

  it("does not reuse a persisted key for a different normalized request", async () => {
    const storage = createStorage();
    const api = createApi();
    const randomUUID = vi.fn().mockReturnValueOnce("intent-1").mockReturnValueOnce("intent-2");
    const controller = createCheckoutPageController({ api, view: createView(), randomUUID, storage });
    await login(controller, api);
    api.previewPurchase.mockResolvedValue(preview);

    await controller.previewPurchase({ amount: "3000", installments: "3" });
    await controller.previewPurchase({ amount: "6000", installments: "3" });

    expect(controller.getState().intent).toMatchObject({ amount: 6_000, idempotencyKey: "intent-2" });
    expect(JSON.parse(storage.getItem(PURCHASE_INTENT_STORAGE_KEY))).toMatchObject({
      request: { amount: 6_000, installments: 3 },
      idempotencyKey: "intent-2",
    });
  });

  it("removes the persisted intent on form invalidation and logout", async () => {
    const storage = createStorage();
    const api = createApi();
    const controller = createCheckoutPageController({ api, view: createView(), randomUUID: () => "intent-1", storage });
    await login(controller, api);
    api.previewPurchase.mockResolvedValue(preview);
    await controller.previewPurchase({ amount: "3000", installments: "3" });

    controller.invalidatePurchaseIntent();
    expect(storage.getItem(PURCHASE_INTENT_STORAGE_KEY)).toBeNull();

    await controller.previewPurchase({ amount: "3000", installments: "3" });
    controller.logout();
    expect(storage.getItem(PURCHASE_INTENT_STORAGE_KEY)).toBeNull();
    expect(controller.getState()).toMatchObject({ token: null, user: null, intent: null });
  });

  it("clears the persisted key immediately after purchase success, before refreshing credit", async () => {
    const storage = createStorage();
    const api = createApi();
    const pendingCredit = deferred();
    const controller = createCheckoutPageController({ api, view: createView(), randomUUID: () => "intent-1", storage });
    await login(controller, api);
    api.previewPurchase.mockResolvedValueOnce(preview);
    await controller.previewPurchase({ amount: "3000", installments: "3" });
    api.createPurchase.mockResolvedValueOnce({ purchase: { id: "purchase-1" } });
    api.getCreditLine.mockReturnValueOnce(pendingCredit.promise);

    const confirmation = controller.confirmPurchase();
    await vi.waitFor(() => expect(api.getCreditLine).toHaveBeenCalledTimes(2));
    expect(storage.getItem(PURCHASE_INTENT_STORAGE_KEY)).toBeNull();
    pendingCredit.resolve(credit);
    await confirmation;
  });

  it("creates a fresh key for the next purchase after a successful confirmation", async () => {
    const storage = createStorage();
    const api = createApi();
    const randomUUID = vi.fn().mockReturnValueOnce("intent-1").mockReturnValueOnce("intent-2");
    const controller = createCheckoutPageController({ api, view: createView(), randomUUID, storage });
    await login(controller, api);
    api.previewPurchase.mockResolvedValue(preview);
    await controller.previewPurchase({ amount: "3000", installments: "3" });
    api.createPurchase.mockResolvedValueOnce({ purchase: { id: "purchase-1" } });
    api.getCreditLine.mockResolvedValueOnce(credit);

    await controller.confirmPurchase();
    await controller.previewPurchase({ amount: "3000", installments: "3" });

    expect(controller.getState().intent.idempotencyKey).toBe("intent-2");
    expect(JSON.parse(storage.getItem(PURCHASE_INTENT_STORAGE_KEY))).toMatchObject({
      idempotencyKey: "intent-2",
    });
  });

  it("ignores every checkout transition and duplicate confirmation while confirming", async () => {
    const api = createApi();
    const view = createView();
    const pendingPurchase = deferred();
    const controller = createCheckoutPageController({ api, view, randomUUID: () => "intent-1", storage: createStorage() });
    await login(controller, api);
    api.previewPurchase.mockResolvedValueOnce(preview);
    await controller.previewPurchase({ amount: "3000", installments: "3" });
    api.createPurchase.mockReturnValueOnce(pendingPurchase.promise);

    const confirmation = controller.confirmPurchase();
    await vi.waitFor(() => expect(api.createPurchase).toHaveBeenCalledOnce());
    await Promise.all([
      controller.confirmPurchase(),
      controller.login({ email: "other@user.test", password: "secret" }),
      controller.previewPurchase({ amount: "6000", installments: "3" }),
    ]);
    controller.logout();
    controller.invalidatePurchaseIntent();

    expect(api.createPurchase).toHaveBeenCalledOnce();
    expect(api.login).toHaveBeenCalledOnce();
    expect(api.previewPurchase).toHaveBeenCalledOnce();
    expect(controller.getState().intent).not.toBeNull();
    expect(view.setInteractionLocked).toHaveBeenCalledWith(true);

    pendingPurchase.resolve({ purchase: { id: "purchase-1" } });
    api.getCreditLine.mockResolvedValueOnce(credit);
    await confirmation;
    expect(view.setInteractionLocked).toHaveBeenLastCalledWith(false);
  });

  it("invalidates corrupt persisted JSON", async () => {
    const storage = createStorage();
    storage.setItem(PURCHASE_INTENT_STORAGE_KEY, "not-json");
    const api = createApi();
    const controller = createCheckoutPageController({ api, view: createView(), randomUUID: () => "intent-1", storage });
    await login(controller, api);

    expect(storage.getItem(PURCHASE_INTENT_STORAGE_KEY)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(PURCHASE_INTENT_STORAGE_KEY);
  });

  it("propagates localStorage read failures", async () => {
    const storageError = new Error("storage read failed");
    const storage = createStorage();
    storage.getItem.mockImplementation(() => { throw storageError; });
    const api = createApi();
    const controller = createCheckoutPageController({ api, view: createView(), storage });

    await expect(controller.login({ email: "demo@cashea.local", password: "secret" })).rejects.toBe(storageError);
    expect(api.login).not.toHaveBeenCalled();
  });

  it("propagates localStorage write failures", async () => {
    const storageError = new Error("storage write failed");
    const storage = createStorage();
    storage.setItem.mockImplementation(() => { throw storageError; });
    const api = createApi();
    const controller = createCheckoutPageController({ api, view: createView(), randomUUID: () => "intent-1", storage });
    await login(controller, api);
    api.previewPurchase.mockResolvedValueOnce(preview);

    await expect(controller.previewPurchase({ amount: "3000", installments: "3" })).rejects.toBe(storageError);
    expect(controller.getState().intent).toBeNull();
  });

  it("propagates localStorage removal failures after purchase success", async () => {
    const storageError = new Error("storage removal failed");
    const storage = createStorage();
    const api = createApi();
    const view = createView();
    const controller = createCheckoutPageController({ api, view, randomUUID: () => "intent-1", storage });
    await login(controller, api);
    api.previewPurchase.mockResolvedValueOnce(preview);
    await controller.previewPurchase({ amount: "3000", installments: "3" });
    api.createPurchase.mockResolvedValueOnce({ purchase: { id: "purchase-1" } });
    storage.removeItem.mockImplementation(() => { throw storageError; });

    await expect(controller.confirmPurchase()).rejects.toBe(storageError);
    expect(api.createPurchase).toHaveBeenCalledOnce();
    expect(view.setInteractionLocked).toHaveBeenLastCalledWith(false);
  });

  it("never resubmits a confirmed purchase when the independent credit refresh fails", async () => {
    const api = createApi();
    const view = createView();
    const controller = createCheckoutPageController({ api, view, randomUUID: () => "intent-1" });
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
    const controller = createCheckoutPageController({ api, view, randomUUID: () => "intent-1" });
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
