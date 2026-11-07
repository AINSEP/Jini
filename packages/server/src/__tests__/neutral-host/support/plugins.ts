/**
 * Installs a bundled plugin into the neutral host the way any host would: pack its published
 * directory, then install the archive through the public lifecycle. The directory is found through
 * the package's public subpath export, never a private file path.
 */
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { NeutralHost } from './host.ts';

const require = createRequire(import.meta.url);

/** Plugins whose only runtime class is skills: they ship skills, no contribution file and no MCP server. */
export const SKILLS_ONLY_PLUGIN_IDS = [
  'charts-echarts', 'charts-recharts', 'commerce', 'formspree', 'google-forms', 'jev', 'opentelemetry', 'posthog',
  'sentry', 'shopify', 'site-compliance', 'site-import', 'slide-design', 'software-engineering', 'ui-ux-design', 'wordpress',
] as const;

/** The published directory of one bundled plugin. */
export function bundledPluginDir(required: { readonly pluginId: string }, _optional: Record<string, never> = {}): string {
  return dirname(require.resolve(`@jini-ai/agent-plugins/${required.pluginId}`));
}

/** Packs and installs one bundled plugin into the host's workspace. */
export async function installBundledPlugin(required: { readonly host: NeutralHost; readonly pluginId: string }, _optional: Record<string, never> = {}) {
  const { host } = required;
  const packed = await host.lifecycle.packAgentPluginDirectory({ sourceDir: bundledPluginDir({ pluginId: required.pluginId }) });
  return host.lifecycle.installAgentPlugin({ archive: packed.bytes, expectedSha256: packed.sha256,
    archiveReader: host.lifecycle.createBundledSourceArchiveReader({}), layout: host.layout, workspaceId: host.workspaceId });
}
