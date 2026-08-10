import { createApiClient } from "./api-client.mjs";
import { createCheckoutPageController } from "./checkout-page-controller.mjs";
import { bindCheckout, createDomView } from "./dom.mjs";
import { createMoneyFormatter } from "./format-money.mjs";

const view = createDomView(document, createMoneyFormatter(navigator.language));
const controller = createCheckoutPageController({ api: createApiClient(), view });

bindCheckout(document, controller);
