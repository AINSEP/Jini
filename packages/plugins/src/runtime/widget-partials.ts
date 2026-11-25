import { renderPluginWidgetFragments, type PluginContributionRegistry } from '../host/contributions.js';
import type { PluginActivationRepoPort } from '@jini-ai/core/contracts/site/plugins-host';

export async function renderPluginWidgetPartials(required: {
  html: string; workspaceId: string; contributions: PluginContributionRegistry;
  activationRepo: Pick<PluginActivationRepoPort, 'getActivation'>;
  render: {
    readNames(required: { html: string }): readonly string[];
    validateHtml: Parameters<typeof renderPluginWidgetFragments>[0]['validateHtml'];
    expand(required: { html: string; partials: Readonly<Record<string, string>>; slots: Record<string, { source: string }> }): string;
  };
}, _optional: Record<string, never> = {}): Promise<string> {
  const names = required.render.readNames({ html: required.html });
  if (!names.length) return required.html;
  const partials = await renderPluginWidgetFragments({ registry: required.contributions, names, workspaceId: required.workspaceId,
    isEnabled: async ({ pluginId }) => (await required.activationRepo.getActivation({ workspaceId: required.workspaceId, pluginId }))?.enabled === true,
    validateHtml: required.render.validateHtml,
  });
  const slots = Object.fromEntries(Object.keys(partials).map(name => [name, { source: `${name}.html` }]));
  return required.render.expand({ html: required.html, partials, slots });
}
