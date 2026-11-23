import type { FormDestinationRegistry, LoadedFormDestination } from "../index.js";

/**
 * @file Which receiver takes a static publish's form submissions, from the site's `core.forms`
 * `receiver` setting (`features/settings/form-destination.ts`) and the publish's hosting target.
 * `auto` (the default) is the co-hosted destination for that host, which is exactly what publishing
 * did before destinations were their own category. Pure.
 */

export const FORM_RECEIVER_AUTO = "auto";
export const FORM_RECEIVER_NONE = "none";

export type FormReceiverSelection =
  | { readonly kind: "co-hosted" | "external"; readonly destination: LoadedFormDestination; readonly scope: string }
  | { readonly kind: "none"; readonly reason: string }
  /** The site named a receiver that cannot take this publish: say so rather than lose submissions. */
  | { readonly kind: "refused"; readonly message: string };

/**
 * `scope` is the receiver key's and the dedupe receipts' identity: the hosting target id for a
 * co-hosted receiver (it lives in that host's deployment), the destination id for an external one.
 * @complexity O(n * h) over the registry's destinations and their hosts.
 */
export function selectFormReceiver(
  required: { registry: FormDestinationRegistry; setting: string | undefined; hostingTargetId: string },
  _optional: Record<string, never> = {},
): FormReceiverSelection {
  const { registry, hostingTargetId } = required;
  const choice = required.setting?.trim() || FORM_RECEIVER_AUTO;
  if (choice === FORM_RECEIVER_NONE) return { kind: "none", reason: "the site's form receiver setting (core.forms receiver) is none" };
  if (choice === FORM_RECEIVER_AUTO) return autoReceiver({ registry, hostingTargetId });
  const destination = registry.get(choice);
  if (!destination) return { kind: "refused", message: `form destination '${choice}' is not installed, or its plugin is turned off. Turn the plugin on, or set the site's form receiver (core.forms receiver) to auto or none, then publish again` };
  return namedReceiver({ destination, hostingTargetId });
}

/** The co-hosted destination whose hosts include this target, or none. @complexity O(n * h). */
function autoReceiver({ registry, hostingTargetId }: { registry: FormDestinationRegistry; hostingTargetId: string }, _optional = {}): FormReceiverSelection {
  const destination = registry.list().find((entry) => entry.descriptor.receive === "co-hosted" && entry.descriptor.hosts?.includes(hostingTargetId));
  return destination
    ? { kind: "co-hosted", destination, scope: hostingTargetId }
    : { kind: "none", reason: `no installed form destination receives submissions on hosting target ${hostingTargetId}` };
}

/** A destination the site named explicitly; refused when it cannot receive on this host. @complexity O(h). */
function namedReceiver({ destination, hostingTargetId }: { destination: LoadedFormDestination; hostingTargetId: string }, _optional = {}): FormReceiverSelection {
  const { id, receive, hosts = [] } = destination.descriptor;
  if (receive === "external") return { kind: "external", destination, scope: id };
  if (receive === "co-hosted" && hosts.includes(hostingTargetId)) return { kind: "co-hosted", destination, scope: hostingTargetId };
  if (receive === "co-hosted") return { kind: "refused", message: `form destination '${id}' receives submissions only on ${hosts.join(", ")}, not on ${hostingTargetId}. Publish to one of those hosts, or set the site's form receiver (core.forms receiver) to auto or none, then publish again` };
  return { kind: "refused", message: `form destination '${id}' does not receive browser submissions. Set the site's form receiver (core.forms receiver) to auto or to a destination that receives them, then publish again` };
}
