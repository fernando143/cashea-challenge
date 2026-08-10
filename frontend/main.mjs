import { createApiClient } from "./api-client.mjs";
import { createCheckoutController } from "./checkout-controller.mjs";
import { bindCheckout, createDomView } from "./dom.mjs";
import { createMoneyFormatter } from "./format-money.mjs";

const view = createDomView(document, createMoneyFormatter(navigator.language));
const controller = createCheckoutController({ api: createApiClient(), view });

bindCheckout(document, controller);
