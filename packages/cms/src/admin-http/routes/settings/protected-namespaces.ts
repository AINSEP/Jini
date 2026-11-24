import { resolveDefinitionRaw, type SettingsRepoPort } from "@jini-ai/core/settings";

/**
 * @file Whether a generic settings write reaches a host-protected namespace (by name, rename,
 * alias or namespace reset). The host decides which namespaces are protected (owner-only grants,
 * code-owned defaults) and injects them; this module only resolves the request against the ledger.
 */

type BodyItem = Record<string, unknown>;


/** What every item check needs: the repo to resolve through and the namespaces being protected. */
type ProtectedScope = { repo: SettingsRepoPort; workspaceId: string; namespaces: readonly string[] };

/** The items a request body asks to change: each entry of a definition batch, otherwise the body
 * itself. A null or non-object body changes nothing checkable.
 * @complexity O(1).
 */
function bodyItems({ body }: { body: unknown }, _options: Record<string, never> = {}): { items: unknown[]; definitionBatch: boolean } {
  if (!body || typeof body !== "object") return { items: [], definitionBatch: false };
  const definitions = (body as BodyItem).definitions;
  return Array.isArray(definitions) ? { items: definitions, definitionBatch: true } : { items: [body], definitionBatch: false };
}

/** True when the item names a protected namespace directly, or renames into one. Values are
 * compared by their string form, so a non-string namespace still fails closed when it stringifies
 * to a protected name.
 * @complexity O(n) over the protected namespaces.
 */
function namesProtectedNamespace({ item, namespaces }: { item: BodyItem; namespaces: readonly string[] }, _optional: Record<string, never> = {}): boolean {
  return namespaces.includes(String(item.namespace)) || namespaces.includes(String(item.newNamespace));
}

/** The keys whose resolution decides the item: its own key, or for a key-less reset every active
 * platform-then-workspace definition in its namespace. A key-less definition-batch item is never
 * expanded (it cannot address a definition), so it resolves nothing.
 * @complexity O(d) over the registered definitions for a reset, otherwise O(1).
 */
async function keysToResolve({ item, scope, definitionBatch }: { item: BodyItem & { namespace: string }; scope: ProtectedScope; definitionBatch: boolean }, _options: Record<string, never> = {}): Promise<string[]> {
  if (typeof item.key === "string") return [item.key];
  if (definitionBatch) return [];
  return [
    ...await scope.repo.listActiveDefinitions({ workspaceId: null }),
    ...await scope.repo.listActiveDefinitions({ workspaceId: scope.workspaceId }),
  ].filter((def) => def.namespace === item.namespace).map((def) => def.key);
}

/** True as soon as one key resolves (through aliases) to a protected namespace; later keys are not
 * resolved.
 * @complexity O(k) bounded alias resolutions.
 */
async function anyKeyResolvesProtected({ namespace, keys, scope }: { namespace: string; keys: readonly string[]; scope: ProtectedScope }, _options: Record<string, never> = {}): Promise<boolean> {
  for (const key of keys) {
    const def = await resolveDefinitionRaw({ repo: scope.repo }, { namespace, key, workspaceId: scope.workspaceId });
    if (def && scope.namespaces.includes(def.namespace)) return true;
  }
  return false;
}

/** Whether one body item reaches a protected namespace by name, rename, alias or reset.
 * Non-object items and items without a string namespace touch nothing.
 * @complexity As `keysToResolve` plus `anyKeyResolvesProtected`.
 */
async function itemTouchesProtected({ raw, scope, definitionBatch }: { raw: unknown; scope: ProtectedScope; definitionBatch: boolean }, _options: Record<string, never> = {}): Promise<boolean> {
  if (!raw || typeof raw !== "object") return false;
  const item = raw as BodyItem;
  if (namesProtectedNamespace({ item, namespaces: scope.namespaces })) return true;
  if (typeof item.namespace !== "string") return false;
  const namespaced = item as BodyItem & { namespace: string };
  return anyKeyResolvesProtected({ namespace: namespaced.namespace, keys: await keysToResolve({ item: namespaced, scope, definitionBatch }), scope });
}

/** Generic settings mutations cannot bypass a host's dedicated endpoint for a protected namespace.
 * Resolving aliases also prevents laundering a protected key through another namespace.
 * Definition batches are checked entirely before any item writes; renaming into the namespace
 * is blocked too, so a code-owned default cannot be replaced through the ledger browser.
 * @complexity O(d) for a namespace reset (d registered definitions), O(b) for a definition batch,
 * otherwise one bounded alias resolution. No writes.
 */
export async function touchesProtectedNamespaces(required: {
  body: unknown; repo: SettingsRepoPort; workspaceId: string; namespaces: readonly string[];
}, _optional: Record<string, never> = {}): Promise<boolean> {
  const scope: ProtectedScope = { repo: required.repo, workspaceId: required.workspaceId, namespaces: required.namespaces };
  const { items, definitionBatch } = bodyItems({ body: required.body });
  for (const raw of items) {
    if (await itemTouchesProtected({ raw, scope, definitionBatch })) return true;
  }
  return false;
}
