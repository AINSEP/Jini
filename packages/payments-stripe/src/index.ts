/**
 * @file `@jini-ai/payments-stripe`: the Stripe payment provider plugin for the commerce payments
 * kernel. The package root is also the agent-plugin root: `plugin.json` declares
 * `extensions["ai.jini.commerce"].provider = "./dist/index.js"`, whose DEFAULT export is the
 * provider the host's trusted contribution loader validates and registers.
 */
import { createStripeProvider } from "./provider.js";

export { createStripeProvider, STRIPE_API_BASE, STRIPE_API_VERSION, STRIPE_PROVIDER_ID, type StripeProviderOptional } from "./provider.js";
export { parseStripeSignatureHeader, signStripePayload, verifyStripeSignature, type SignatureVerdict, type StripeSignatureHeader } from "./signature.js";
export { classifyStripeFailure, type StripeErrorFields, type StripeFailure } from "./errors.js";

/** The provider instance the plugin loader imports (default options: api.stripe.com, pinned API version, 300 s tolerance). */
const stripeProvider = createStripeProvider();
export default stripeProvider;
