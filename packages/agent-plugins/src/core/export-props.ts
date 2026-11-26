import { exceedsAdminSurfacePayloadLimit, validateAdminSurfaceActionValue } from "../contracts/admin-surface-action-schema.js";
import type { AgentPluginExport } from "@jini-ai/core/contracts/site/agent-plugins-manifest";

export type Entry = Readonly<Record<string, unknown>>;

/** Save and render share the existing bounded schema/value policy; messages never echo prop values.
 * @returns First validation reason, or null on success. No side effects. @complexity O(p) prop values.
 */
export function validateAgentPluginExportProps(
  { definition, props }: { readonly definition: AgentPluginExport; readonly props: unknown },
  _optional: Record<string, never> = {},
): string | null {
  if (exceedsAdminSurfacePayloadLimit({ payload: props })) return 'props exceed the payload limit';
  return validateAdminSurfaceActionValue({ schema: definition.props, value: props }) ?? checkUrlPropValues({ definition, props });
}

function isPageOn({ value, hosts }: { readonly value: unknown; readonly hosts: readonly string[] }, _optional = {}): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.pathname !== '/' && hosts.includes(url.origin);
  } catch { return false; }
}

/** Runs after the schema, so props is a closed object. Reasons name the host, never the value. */
function checkUrlPropValues({ definition, props }: { readonly definition: AgentPluginExport; readonly props: unknown }, _optional = {}): string | null {
  const hosts = definition.externalHosts?.frame ?? [];
  for (const name of definition.urlProps ?? []) {
    const value = (props as Entry)[name];
    if (value !== undefined && !isPageOn({ value, hosts })) return `${name} must be an https link to a page on ${hosts.join(' or ')}`;
  }
  return null;
}
