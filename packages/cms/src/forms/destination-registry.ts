import { formDestinationMissingMethods } from "./destination-descriptors.js";
import type { FormDestinationRegistry, LoadedFormDestination } from "./destination-contracts.js";

/**
 * Indexes loaded destinations: drops a module missing the methods its receive mode needs, every id
 * more than one plugin declares, and every host more than one co-hosted destination claims. Pure.
 * @complexity O(n * h) for n loaded destinations with h hosts each.
 */
export function buildFormDestinationRegistry(required: { readonly loaded: readonly LoadedFormDestination[]; readonly refusals: readonly string[] }, _optional: Record<string, never> = {}): FormDestinationRegistry {
  const refusals = [...required.refusals];
  const complete = required.loaded.filter((entry) => {
    const missing = formDestinationMissingMethods({ entry });
    if (missing) refusals.push(`form destination '${entry.descriptor.id}' from '${entry.pluginId}' was not loaded: ${missing}`);
    return !missing;
  });
  const unique = dropShared({ entries: complete, keysOf: ({ entry }) => [entry.descriptor.id], refusals, what: ({ key: id }) => `form destination '${id}'`, why: "more than one plugin declares it" });
  const unclaimed = dropShared({ entries: unique, keysOf: ({ entry }) => (entry.descriptor.receive === "co-hosted" ? entry.descriptor.hosts ?? [] : []), refusals,
    what: ({ key: host }) => `form receiver for host '${host}'`, why: "more than one co-hosted destination claims it" });
  return {
    list: () => unclaimed,
    get: (id) => unclaimed.find((entry) => entry.descriptor.id === id),
    resolve: ({ scope }) => unclaimed.find((entry) => entry.descriptor.id === scope)
      ?? unclaimed.find((entry) => entry.descriptor.receive === "co-hosted" && entry.descriptor.hosts?.includes(scope)),
    refusals,
  };
}

/** Keeps the entries none of whose keys another entry shares; each shared key is one refusal line.
 * @complexity O(n * k) for n entries with k keys each. */
function dropShared(
  required: { entries: readonly LoadedFormDestination[]; keysOf: (required: { entry: LoadedFormDestination }) => readonly string[]; refusals: string[]; what: (required: { key: string }) => string; why: string },
  _optional: Record<string, never> = {},
): LoadedFormDestination[] {
  const { entries, keysOf, refusals, what, why } = required;
  const claimants = new Map<string, LoadedFormDestination[]>();
  for (const entry of entries) for (const key of new Set(keysOf({ entry }))) claimants.set(key, [...(claimants.get(key) ?? []), entry]);
  const dropped = new Set<LoadedFormDestination>();
  for (const [key, owners] of claimants) {
    if (owners.length < 2) continue;
    owners.forEach((owner) => dropped.add(owner));
    const pluginIds = owners.map((owner) => `'${owner.pluginId}'`).sort().join(", ");
    refusals.push(`${what({ key })} was not loaded: ${why} (${pluginIds})`);
  }
  return entries.filter((entry) => !dropped.has(entry));
}

