import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../frontend/api-client.mjs";
import {
  MAX_AMOUNT_CENTS,
  PURCHASE_INTENT_STORAGE_KEY,
  parsePurchaseInput,
} from "../../frontend/checkout-controller.mjs";
import { createCheckoutPageController } from "../../frontend/checkout-page-controller.mjs";

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
