import { createCheckoutController } from "./checkout-controller.mjs";
import { createInteractionLock } from "./interaction-lock.mjs";
import { createSessionController } from "./session-controller.mjs";

export function createCheckoutPageController({ api, view, randomUUID, storage }) {
  const interactionLock = createInteractionLock(view);
  let checkout;
  const session = createSessionController({
    api, view, interactionLock,
    onSessionChanging: (user) => checkout.prepareSession(user),
    onLogout: () => checkout.clearPurchaseIntent(),
  });
  checkout = createCheckoutController({
    api, view, interactionLock, getSession: session.getSession, randomUUID, storage,
  });
  return {
    login: session.login,
    logout: session.logout,
    previewPurchase: checkout.previewPurchase,
    confirmPurchase: checkout.confirmPurchase,
    invalidatePurchaseIntent: checkout.invalidatePurchaseIntent,
    getState: () => ({ ...session.getSession(), ...checkout.getState() }),
  };
}
