import type { AdminSurfacePublicConfig } from "../../admin-surfaces/index.js";

/**
 * @file The `publicConfig` port for plugin admin-surface handlers: host settings a surface may see
 * (a browser app id, a public browser key), read from the host's configuration by the names the
 * surface declared. Values are placeholders the operator configures; unset reads as `null`.
 *
 * Why the host narrows names beyond the declaration check: the declaration only refuses
 * secret-looking words, but this port reads the process environment, which also holds settings such
 * as the site's encryption key or storage keys whose names contain none of them. So only names the
 * host's `publicNamePattern` shapes like public plugin config are read (for example `…_APP_ID`,
 * `…_CLIENT_ID`, `…_BROWSER_KEY` or `…_PUBLIC_KEY`), and never one with a secret word.
 */

const SECRET_WORDS = /SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|COOKIE|SESSION|SIGNING/;
export const PUBLIC_CONFIG_REFUSED_MESSAGE = "This setting is not public configuration, so a plugin surface cannot read it.";

/**
 * @param required.env - The configuration the port reads (the process environment on a node host).
 * @param required.publicNamePattern - The host's allow-list of public-config names (its own prefix and suffix shapes).
 * @complexity O(1) per read.
 */
export function createAdminSurfacePublicConfig(
  required: { readonly env: Readonly<Record<string, string | undefined>>; readonly publicNamePattern: RegExp },
  _optional: Record<string, never> = {},
): AdminSurfacePublicConfig {
  return {
    async get({ name }) {
      if (!required.publicNamePattern.test(name) || SECRET_WORDS.test(name)) throw new Error(PUBLIC_CONFIG_REFUSED_MESSAGE);
      return required.env[name]?.trim() || null;
    },
  };
}
