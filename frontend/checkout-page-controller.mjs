import { createCheckoutController } from "./checkout-controller.mjs";
import { createInteractionLock } from "./interaction-lock.mjs";
import { createPurchaseDetailsController } from "./purchase-details-controller.mjs";
import { createSessionController } from "./session-controller.mjs";

export function createCheckoutPageController({ api, view, randomUUID, storage }) {
  const interactionLock = createInteractionLock(view);
  let checkout;
  let purchaseDetails;
  const session = createSessionController({
    api, view, interactionLock,
    onSessionChanging: (user) => {
      checkout.prepareSession(user);
      purchaseDetails.prepareSession(user);
    },
    onLogout: () => {
      try {
        checkout.clearPurchaseIntent();
      } finally {
        purchaseDetails.reset();
      }
    },
  });
  checkout = createCheckoutController({
    api, view, interactionLock, getSession: session.getSession, randomUUID, storage,
  });
  purchaseDetails = createPurchaseDetailsController({
    api, view, interactionLock, getSession: session.getSession, randomUUID, storage,
  });
  return {
    login: session.login,
    logout: session.logout,
    previewPurchase: checkout.previewPurchase,
    confirmPurchase: checkout.confirmPurchase,
    lookupPurchase: purchaseDetails.lookupPurchase,
    payInstallment: purchaseDetails.payInstallment,
    invalidatePurchaseIntent: checkout.invalidatePurchaseIntent,
    getState: () => ({ ...session.getSession(), ...checkout.getState(), ...purchaseDetails.getState() }),
  };
}
