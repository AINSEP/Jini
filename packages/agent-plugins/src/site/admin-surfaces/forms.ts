import { AdminSurfaceActionError, type AdminSurfaceForms } from "../../admin-surfaces/index.js";
import type { SetValueRequired } from "@jini-ai/core/settings";

/**
 * @file The surface forms reader reuses the definition repository behind the admin forms API.
 * Plugin access is not forms access: the signed-in caller must also have `admin.forms.manage`.
 * The repository hides trashed forms; only identities and names leave this adapter. Jini's
 * capability session caps the choices and exposes the port only to a declaring surface.
 */

/**
 * Builds one call's forms reader, scoped by the authenticated host context, never by plugin input.
 * Missing actors, foreign workspaces and denied permissions fail before the repository read.
 * @complexity O(f) time/space for f workspace forms, one authorization and one existing list query.
 */
export function createSurfaceForms(
  required: {
    readonly siteWorkspaceId: string;
    readonly workspaceId: string;
    readonly principalId?: string;
    readonly authorize: SetValueRequired["deps"]["authorize"];
    readonly forms: { list(required: { readonly workspaceId: string }): Promise<readonly { readonly slug: string; readonly name: string }[]> };
  },
  _optional: Record<string, never> = {},
): AdminSurfaceForms {
  return {
    async list(_input, _options = {}) {
      const { workspaceId, principalId } = required;
      if (workspaceId !== required.siteWorkspaceId) throw new AdminSurfaceActionError({ code: "workspace-not-found", message: "This workspace is not available here." });
      if (principalId === undefined) throw new AdminSurfaceActionError({ code: "admin-required", message: "Listing forms needs a signed-in admin." });
      const result = await required.authorize({ principalId, workspaceId, permission: "admin.forms.manage", entityType: "form_definition" });
      if (!result.allowed) throw new AdminSurfaceActionError({ code: "forbidden", message: "You do not have permission to list this site's forms." });
      const forms = await required.forms.list({ workspaceId });
      return forms.map(({ slug, name }) => ({ slug, title: name }));
    },
  };
}
