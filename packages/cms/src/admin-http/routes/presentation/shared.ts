import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";

/**
 * @file Shared guard and theme view for the `presentation` admin route specs (GET presentation,
 * POST themes/rescan).
 *
 * The discovered-theme list, its stored-id resolution (retired ids included) and the catalogue
 * filter are the host's theme discovery, so the specs read them through injected functions and
 * only see the fields below — never the host's own theme type.
 */

/** The principal fields these routes read: none beyond the id the host port authorizes with. */
export interface PresentationRoutePrincipal { id: string }

/** The content kinds an editor asks templates for (the themes domain's `ThemeTemplateKind`, structurally). */
export type PresentationTemplateKind = "post" | "page";

/** The fields of one discovered theme the presentation routes read. */
export interface PresentationThemeView {
  /** Absolute folder the theme was loaded from (the card preview URL is keyed on it). */
  dir: string;
  status: string;
  manifest: {
    id: string;
    name: string;
    tier: string;
    apiVersion?: number;
    templates?: readonly string[];
    templateFor?: Readonly<Record<string, readonly PresentationTemplateKind[]>>;
  };
  pages: Readonly<Record<string, unknown>>;
}

/**
 * Asks the host for `theme.set` on the `presentation` entity type, id-free (the resource is the
 * workspace's one presentation row). A mount without an authorizer is a wiring bug, not a caller
 * error, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeThemeSet(
  { authorize }: { authorize: JsonRouteAuthorize | undefined },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (!authorize) throw new Error("presentation admin route has no authorizer");
  await authorize({ permission: "theme.set", entityType: "presentation" });
}
