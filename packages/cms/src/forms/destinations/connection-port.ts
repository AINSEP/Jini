import type { FormDeliveryConnectionPort } from "@jini-ai/core/contracts/site/cms-forms";

/**
 * @file The connection port this build ships: a binding's `connectionRef` is the stable id of a
 * saved custom credential. The vault owner opens entries by label only, so the label is looked up
 * from the id, and the opened entry's id is checked again: a rename between the two reads could
 * otherwise hand this binding another account's secret. A credential is only handed to an adapter
 * its owner listed in its `worksFor`: any saved credential could otherwise be named by a binding and
 * given to any delivery plugin. An OAuth connection kind is a second `FormDeliveryConnectionPort`,
 * not a change here.
 */

/**
 * Builds the port. Every call reads the vault afresh, so a rotated or deleted credential applies to
 * the next attempt; nothing is cached or written anywhere.
 * @returns null when no entry with that id exists in `workspaceId`, its `worksFor` does not name
 *   `adapterId` (checked before the secret is opened), or the label now names another entry; the
 *   vault's own errors (e.g. an unconfigured site key) propagate.
 * @complexity One id read plus one label scan over the workspace's saved credentials and one open.
 */
export function createCustomCredentialConnectionPort(
  required: {
    findById: (required: { workspaceId: string; id: string }) => Promise<{ label: string; worksFor?: readonly string[] | null } | null>;
    resolveByLabel: (required: { workspaceId: string; label: string }) => Promise<{ id: string; connection: { token: string; username?: string }; baseUrl: string; additionalHosts?: readonly string[] } | null>;
  },
  _optional: Record<string, never> = {},
): FormDeliveryConnectionPort {
  const { findById, resolveByLabel } = required;
  return async ({ workspaceId, connectionRef, adapterId }) => {
    const record = await findById({ workspaceId, id: connectionRef });
    // worksFor ids are stored lowercased by the vault's own normalizer.
    if (!record?.worksFor?.includes(adapterId.toLowerCase())) return null;
    const saved = await resolveByLabel({ workspaceId, label: record.label });
    if (saved?.id !== connectionRef) return null;
    return { token: saved.connection.token, baseUrl: saved.baseUrl, ...(saved.additionalHosts === undefined ? {} : { additionalHosts: saved.additionalHosts }),
      ...(saved.connection.username ? { username: saved.connection.username } : {}) };
  };
}
