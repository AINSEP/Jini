import { interpolate } from "@jini-ai/core/text";
import { t as translateForAuthentication } from "./authentication-i18n.js";

/** Bind this screen's copy to the current locale. `productName` is the host's product name (host
 *  copy, K3): it fills the `{product}` slot the dictionary keeps where a brand name used to be. */
export function createAuthenticationTranslator({ locale, productName }: { locale: string; productName: string }, _optional: Record<string, never> = {}) {
  return (key: string): string => interpolate({ template: translateForAuthentication({ locale, key }), vars: { product: productName } });
}
