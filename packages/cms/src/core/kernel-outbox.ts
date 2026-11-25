import { nowIso as kernelNowIso } from "@jini-ai/core/primitives";
import type { Clock } from "@jini-ai/core/primitives";
import type { MutationActor } from "@jini-ai/core/contracts/events";

/** The wrapped real `core/ports` outbox plus what a full `DomainEvent` needs beyond `{name,payload}`. */
export interface KernelOutboxAdapterDeps {
  outbox: {
    enqueue(event: { id: string; workspaceId: string; name: string; occurredAt: string; payload: Record<string, unknown>; actorId?: string; actor?: MutationActor }): Promise<void>;
  };
  clock: Clock;
  idGen: { newId(): string };
  /** `workspaceId` is REQUIRED and is declared on the wrapped port's event type on purpose. A real
   * `core/ports` `DomainEvent` carries `workspaceId` as a non-optional tenant boundary, and
   * persistent adapters store it in a NOT NULL column. This wrapper previously under-declared the
   * wrapped port as `{id,name,occurredAt,payload}` and constructed an event without `workspaceId`, so
   * a host binding a SQLite outbox typechecked cleanly and then threw
   * `NOT NULL constraint failed: outbox_events.workspace_id` on every write. Sourcing it from `deps`
   * rather than from `event.payload` is deliberate: the narrow local port carries only `{name,payload}`
   * and payload contents are per-event convention, not a contract. */
  workspaceId: string;
}

/** Adapts a real `core/ports` outbox into the narrow event shape content write services declare. */
export function toKernelOutbox(
  required: KernelOutboxAdapterDeps,
  _optional: Record<string, never> = {},
): { enqueue(event: { name: string; payload: Record<string, unknown>; actor?: MutationActor | undefined }): Promise<void> } {
  return {
    enqueue: async (event) => {
      await required.outbox.enqueue({
        id: required.idGen.newId(),
        workspaceId: required.workspaceId,
        name: event.name,
        occurredAt: kernelNowIso({ clock: required.clock }),
        payload: event.payload,
        // The writer's trusted actor rides on the event itself, never inside the payload, so the
        // outbox serializer round-trips its kind; an unattributed write records no actor at all.
        ...(event.actor ? { actorId: event.actor.id, actor: event.actor } : {}),
      });
    },
  };
}
