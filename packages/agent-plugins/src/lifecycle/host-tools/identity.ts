/** Host adapter for the shared identity owner. The legacy lifecycle already indexes packageRoot;
 * rereading its manifest keeps new metadata available before compiled lifecycle code is rebuilt. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readPluginIdentity, type PluginIdentity } from '@jini-ai/core/plugin-directory';
import { readAgentPluginPortableExtension } from '../../core/identity-namespace.js';
import type { InstalledAgentPlugin } from '../types.js';

/** Host metadata; absence keeps the plugin's normal presentation and behavior. */
export type PluginMaturity = 'untested' | 'soon';

/** Read the selected portable extension; unknown values warn without rejecting a usable plugin.
 * @returns A supported maturity or undefined. @complexity O(1).
 */
export function readPluginMaturity({ manifest }: { manifest: unknown }, options: { warn?: (message: string) => void } = {}): PluginMaturity | undefined {
  // The portable reader preserves old installed copies when the new namespace is absent.
  const maturity = readAgentPluginPortableExtension({ value: manifest })?.maturity;
  if (maturity === undefined) return undefined;
  if (maturity === 'untested' || maturity === 'soon') return maturity;
  (options.warn ?? console.warn)('[agent-plugins] Unknown extensions.jini.maturity ignored; expected "untested" or "soon".');
  return undefined;
}

/** Provider plugin ids follow the same grammar as a credential card's `saveTarget`. */
const PROVIDER_PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;

/** `extensions.jini.providerPlugin`: the provider plugin this agent plugin is the assistant face of
 *  (owner 2026-10-25: one vendor, one plugin). The provider plugin's switch turns both faces on and
 *  off (`provider-plugin-link.ts`), and the agent plugin owns that provider's settings card.
 *  Unknown shapes warn and read as no link, so a typo never links to a wrong plugin.
 * @complexity O(1). */
export function readProviderPluginLink({ manifest }: { manifest: unknown }, options: { warn?: (message: string) => void } = {}): string | undefined {
  const link = readAgentPluginPortableExtension({ value: manifest })?.providerPlugin;
  if (link === undefined) return undefined;
  if (typeof link === 'string' && PROVIDER_PLUGIN_ID.test(link)) return link;
  (options.warn ?? console.warn)('[agent-plugins] Invalid extensions.jini.providerPlugin ignored; expected a plugin id.');
  return undefined;
}

/** Shared instruction for every host guidance surface, so disclosure precedes credentials/actions. */
export const UNTESTED_PLUGIN_GUIDANCE = "Before saving keys or acting with this plugin, tell the user this integration hasn't been tested end to end yet. It may not work.";

/** Reads metadata only from a lifecycle-validated package root; never imports executable code.
 * @param optional.readText file reader port (defaults to UTF-8 `fs.readFile`).
 * @throws Invalid or unreadable publisher metadata.
 * @complexity One manifest read plus O(k + p) keyword/capability validation.
 */
export async function readInstalledAgentPluginIdentity(
  { plugin }: { plugin: Pick<InstalledAgentPlugin, 'pluginId' | 'packageRoot'> },
  optional: { readText?: (filePath: string) => Promise<string> } = {},
): Promise<PluginIdentity & { readonly maturity?: PluginMaturity; readonly providerPlugin?: string }> {
  const readText = optional.readText ?? ((filePath: string) => readFile(filePath, 'utf8'));
  let manifest: Readonly<Record<string, unknown>>;
  try { manifest = JSON.parse(await readText(path.join(plugin.packageRoot, 'plugin.json'))); }
  catch { throw new Error('The installed plugin identity manifest could not be read.'); }
  const extension = readAgentPluginPortableExtension({ value: manifest });
  const identity = readPluginIdentity({ manifest: { ...manifest, extensions: { jini: extension } }, name: plugin.pluginId, namespace: 'jini' });
  const maturity = readPluginMaturity({ manifest });
  const providerPlugin = readProviderPluginLink({ manifest });
  return { ...identity, ...(maturity ? { maturity } : {}), ...(providerPlugin ? { providerPlugin } : {}) };
}
