import { WidgetForbiddenError } from "./errors.js";

/**
 * @file Shared `authorize()` plumbing for `write-service.ts`/`region-area-service.ts` (SPEC-043
 * REQ-40/41, INV-07).
 *
 * Purpose:
 * `AuthorizeFn` mirrors `features/entries/write-service.ts`'s `AuthorizeFn` shape structurally (no
 * shared import, kept decoupled — the same "no shared import" convention that file's own header
 * documents against `features/content-types`). `requireWidgetPermission` is the ONE place a
 * `widgets.*` permission string gets checked before a mutation proceeds.
 *
 * `PRE_AUTHORIZED` exists because this library composes `features/entries/write-service.ts`'s
 * `createEntry`/`updateEntry` and `features/content-types/write-service.ts`'s `registerContentType`
 * — both of which perform their OWN internal `authorize()` call, hardcoded to the
 * `admin.collections.manage` permission (the generic Collections-domain permission, unrelated to
 * widgets' own `widgets.*` model, and not modifiable — see this task's scope boundary on
 * `features/entries`). Since the real, authoritative check for a widget mutation is the
 * `widgets.*` check `requireWidgetPermission` already performed one layer up, `PRE_AUTHORIZED` is
 * passed as those composed functions' own `authorize` dependency so their internal check is not a
 * second, differently-scoped gate a legitimate `widgets.*`-holding caller could be incorrectly
 * rejected by.
 */
export type WidgetsAuthorizeFn = (params: {
  principalId: string;
  permission: string;
  workspaceId: string;
}) => Promise<{ allowed: boolean; reason: string }>;

export async function requireWidgetPermission(
  required: {
    authorize: WidgetsAuthorizeFn;
    actor: { principalId: string };
    workspaceId: string;
    permission: string;
  },
  _optional: Record<string, never> = {},

): Promise<void> {
  const { authorize, actor, workspaceId, permission } = required;
  const result = await authorize({ principalId: actor.principalId, permission, workspaceId });
  if (!result.allowed) {
    throw new WidgetForbiddenError({ message: `principal '${actor.principalId}' lacks permission '${permission}' (${result.reason})` });
  }
}

/** See file header — passed as the composed entries/content-types chokepoints' own `authorize` dep. */
export const PRE_AUTHORIZED: WidgetsAuthorizeFn = async () => ({
  allowed: true,
  reason: "widgets: authorized upstream via the widgets.* permission check",
});

/** The actor id attributed to fully-automatic, system-driven writes (content-type seeding, theme-activation region seeding — REQ-13). Mirrors `server/seed.ts`'s `SETTINGS_MIGRATION_SYSTEM_PRINCIPAL_ID` convention. */
export const WIDGETS_SYSTEM_ACTOR_ID = "system-widgets";
