import type { MutationActor } from "@jini-ai/core/contracts/events";
import type { UUID } from "@jini-ai/core/primitives";
import { WidgetForbiddenError } from "./errors.js";

/**
 * @file Shared `authorize()` plumbing for `write-service.ts`/`region-area-service.ts`.
 *
 * Purpose:
 * `AuthorizeFn` mirrors `packages/cms/src/entries/write-service.ts`'s `AuthorizeFn` shape structurally (no
 * shared import, kept decoupled — the same "no shared import" convention that file's own header
 * documents against `features/content-types`). `requireWidgetPermission` is the ONE place a
 * `widgets.*` permission string gets checked before a mutation proceeds.
 *
 * `PRE_AUTHORIZED` exists because this library composes `packages/cms/src/entries/write-service.ts`'s
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

/** {@link WIDGETS_SYSTEM_ACTOR_ID} as stamped on the entry events of those system writes. Its `system`
 *  kind is declared here, by the writer that knows it acts for nobody — never inferred from the id. */
export const WIDGETS_SYSTEM_MUTATION_ACTOR: MutationActor = { id: WIDGETS_SYSTEM_ACTOR_ID, kind: "system" };

/**
 * The acting principal of a widget write. `kind` is the attribution its execution channel vouches
 * for (an admin route says `user`, the assistant's tool surface says `agent`); `principalId` still
 * governs authorization. The two are not interchangeable, so a missing `kind` records no actor on
 * the event rather than one guessed from the id. Optional only until every host passes it.
 */
export interface WidgetWriteActor {
  readonly principalId: UUID;
  readonly kind?: MutationActor["kind"] | undefined;
}

/** The trusted actor a widget write stamps on its entry event, or `undefined` when its caller vouched for no kind.
 *  @complexity O(1). */
export function trustedWidgetActor({ actor }: { actor: WidgetWriteActor }, _optional: Record<string, never> = {}): MutationActor | undefined {
  return actor.kind ? { id: actor.principalId, kind: actor.kind } : undefined;
}

