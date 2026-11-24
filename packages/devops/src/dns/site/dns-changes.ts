/**
 * @file DNS plan / instructions / verify over the Jini DNS kernel (`@jini-ai/devops/dns`, lots D1–D3).
 *
 * Planning and verification are the kernel's; this file only orders the steps for one host
 * workspace: requirements (from the caller or the saved `domain_binding`) → zone → NS delegation
 * → current records → plan. Nothing here writes DNS (no apply engine in v1): a person enters the
 * `dns_instructions` rows at their DNS host, then `dns_verify` checks the authoritative servers.
 *
 * `verifyDomainDns` is the single writer of `domain_binding.status`.
 */
import { ToolInputError } from "@jini-ai/core";
import {
  canonicalJson,
  checkDelegation,
  isExpired,
  MANUAL_DNS_PROVIDER_ID,
  nextCheckDelayMs,
  normalizeDnsName,
  planDnsChanges,
  renderDnsInstructions,
  settlePort,
  verifyRequirements,
  type AuthoritativeDnsPort,
  type DelegationCheck,
  type DnsChangePlan,
  type DnsInstructions,
  type DnsInventory,
  type DnsPlanRequirement,
  type DnsProvider,
  type DnsProviderContext,
  type DnsProviderRegistry,
  type DnsRecord,
  type DnsVerification,
} from "../index.js";
import type { DomainBinding, DomainBindingStatus, DomainBindingStore } from "./binding.repo.js";
import { withMailRequirements, type DnsRequirementInclude, type MailRequirementsPort } from "./mail-requirements.js";

/** Kernel blockers plus the host-level ones found before a plan can be trusted. */
export interface DomainDnsBlocker {
  code: string;
  name: string;
  message: string;
  suggestion?: string;
}

export interface DomainDnsPlan {
  hostname: string;
  providerId: string;
  zone: string;
  /** False when no zone could be located; the zone shown is then the hostname itself. */
  zoneFound: boolean;
  delegation: DelegationCheck | null;
  plan: DnsChangePlan;
  blockers: DomainDnsBlocker[];
}

/** Ports for one workspace. `context` carries the pre-resolved provider credentials. */
export interface DnsChangePorts {
  registry: DnsProviderRegistry;
  resolver: AuthoritativeDnsPort;
  context: DnsProviderContext;
  bindings?: DomainBindingStore;
  /** The resolved mailer's `domainRequirements`, read for `include: ["mail"]`. Absent: that include refuses. */
  mailRequirements?: MailRequirementsPort;
}

/** A hostname, optionally its requirements, and what to add to them. */
export interface DnsChangeRequest {
  hostname: string;
  requirements?: DnsPlanRequirement[];
  include?: DnsRequirementInclude[];
}

interface Target {
  hostname: string;
  providerId: string;
  provider: DnsProvider;
  requirements: DnsPlanRequirement[];
  binding: DomainBinding | null;
}

interface Zone { zone: string; ref: string; found: boolean }

/** The registered provider, or a caller error naming the saved id. */
function providerFor(required: { providerId: string; hostname: string; errorPrefix: string }, ports: DnsChangePorts): DnsProvider {
  const provider = ports.registry.get({ id: required.providerId })?.provider;
  if (provider === undefined) throw new ToolInputError({ message: `${required.errorPrefix}: the DNS provider '${required.providerId}' saved for ${required.hostname} is not installed.` });
  return provider;
}

/**
 * Caller requirements win; otherwise the binding's persisted ones. `include: ["mail"]` then adds the
 * active mail provider's records (through the port). No requirements is a caller error.
 */
async function resolveTarget(required: DnsChangeRequest & { errorPrefix: string }, ports: DnsChangePorts): Promise<Target> {
  const binding = (await ports.bindings?.get({ hostname: required.hostname })) ?? null;
  const providerId = binding?.providerId ?? MANUAL_DNS_PROVIDER_ID;
  const provider = providerFor({ ...required, providerId }, ports);
  const base = requestedRequirements({ required, binding });
  const requirements = required.include?.includes("mail") ? await withMailRequirements({ ...required, requirements: base }, { ...ports, provider }) : base;
  if (requirements.length === 0) {
    throw new ToolInputError({ message: `${required.errorPrefix}: no DNS requirements are saved for ${required.hostname}; pass requirements (the records the host or mail provider asked for).` });
  }
  return { hostname: required.hostname, providerId, provider, requirements, binding };
}

/** Explicit requirements, including an empty list, take precedence over a saved binding. */
function requestedRequirements({ required, binding }: { required: DnsChangeRequest; binding: DomainBinding | null }, _options = {}): DnsPlanRequirement[] {
  return required.requirements ?? binding?.requirements ?? [];
}

/** The provider's zone for the hostname; the saved zone (or the hostname) when none answers. */
async function locateZone(target: Target, ports: DnsChangePorts): Promise<Zone> {
  const result = await settlePort({ call: () => target.provider.findZone(ports.context, { hostname: target.hostname }) });
  if (result.status === "ok" && result.value !== null) return { zone: result.value.zone, ref: result.value.ref, found: true };
  const fallback = target.binding?.zone ?? target.hostname;
  return { zone: fallback, ref: fallback, found: false };
}

type Listed = { records: readonly DnsRecord[]; inventory: DnsInventory };

const INVENTORY_RANK: Readonly<Record<DnsInventory, number>> = { complete: 0, partial: 1, unknown: 2 };

/** The least complete of several inventories: one unread part makes the whole view that unread. */
const worstInventory = (inventories: readonly DnsInventory[]): DnsInventory =>
  inventories.reduce<DnsInventory>((worst, next) => (INVENTORY_RANK[next] > INVENTORY_RANK[worst] ? next : worst), "complete");

/** Distinct normalized record names the requirements ask for. */
function requirementNames(target: Target): string[] {
  return [...new Set(target.requirements.flatMap(requirement => requirement.records).map(record => normalizeDnsName({ name: record.name })))];
}

const inZone = ({ name, zone }: { name: string; zone: string }, _options = {}): boolean => name === zone || name.endsWith(`.${zone}`);

/** `a.b.example.com` → itself and each parent below the TLD (a wildcard label is dropped). */
function selfAndAncestors({ name }: { name: string }, _options = {}): string[] {
  const names: string[] = [];
  for (let candidate = normalizeDnsName({ name }).replace(/^\*\./, ""); candidate.includes("."); candidate = candidate.slice(candidate.indexOf(".") + 1)) names.push(candidate);
  return names;
}

/**
 * Names whose CAA set can cover a requirement (RFC 8659 tree climbing) and are not already listed:
 * the zone apex and every ancestor up to (not including) the TLD. Only read when a requirement
 * names a CA, since only then does the planner check CAA.
 */
function caaNames(target: Target): string[] {
  if (!target.requirements.some(requirement => requirement.caa !== undefined)) return [];
  const listed = new Set(requirementNames(target));
  const covered = target.requirements.flatMap(requirement => [requirement.domain, ...requirement.records.map(record => record.name)]);
  return [...new Set(covered.flatMap(name => selfAndAncestors({ name })))].filter(name => !listed.has(name));
}

/** The provider's zone ref for a name outside the target zone; `null` when no zone serves it, `undefined` when unreadable. */
async function zoneRefOf({ name, target, ports }: { name: string; target: Target; ports: DnsChangePorts }, _options = {}): Promise<string | null | undefined> {
  const result = await settlePort({ call: () => target.provider.findZone(ports.context, { hostname: name }) });
  return result.status === "ok" ? (result.value?.ref ?? null) : undefined;
}

/** The CAA set at one ancestor, read from whichever zone serves it (a parent zone above a delegated child included). */
async function caaAt({ name, zone, target, ports }: { name: string; zone: Zone; target: Target; ports: DnsChangePorts }, _options = {}): Promise<Listed> {
  const ref = inZone({ name, zone: zone.zone }) ? zone.ref : await zoneRefOf({ name, target, ports });
  // No zone serves the name: nothing there can restrict issuance.
  if (ref === null) return { records: [], inventory: "complete" };
  if (ref === undefined) return { records: [], inventory: "unknown" };
  const result = await settlePort({ call: () => target.provider.listRecords(ports.context, { zoneRef: ref, names: [name] }) });
  if (result.status !== "ok") return { records: [], inventory: "unknown" };
  return { records: result.value.records.filter(record => record.type === "CAA"), inventory: result.value.inventory };
}

/**
 * Current records at the required names, plus the CAA sets of their ancestors; anything unreadable
 * is `unknown`, never "empty" (an unread CAA restriction must not pass as no restriction).
 */
async function listCurrent({ target, zone, ports }: { target: Target; zone: Zone; ports: DnsChangePorts }, _options = {}): Promise<Listed> {
  const names = requirementNames(target);
  const [result, ancestors] = await Promise.all([
    settlePort({ call: () => target.provider.listRecords(ports.context, { zoneRef: zone.ref, names }) }),
    Promise.all(caaNames(target).map(name => caaAt({ name, zone, target, ports }))),
  ]);
  const own: Listed = result.status === "ok" ? result.value : { records: [], inventory: "unknown" };
  return { records: [...own.records, ...ancestors.flatMap(read => read.records)], inventory: worstInventory([own.inventory, ...ancestors.map(read => read.inventory)]) };
}

/** Which zone serves `name`, as far as can be read: the target zone unless proven otherwise. */
async function authorityOf({ name, zone, target, ports }: { name: string; zone: Zone; target: Target; ports: DnsChangePorts }, _options = {}): Promise<string | undefined> {
  if (!inZone({ name, zone: zone.zone })) return undefined;
  if (name === zone.zone || name === normalizeDnsName({ name: target.hostname })) return zone.zone;
  const result = await settlePort({ call: () => target.provider.findZone(ports.context, { hostname: name }) });
  // An unreadable lookup is not proof of another zone.
  return result.status === "ok" && result.value !== null ? result.value.zone : zone.zone;
}

/**
 * Every requirement name must be served by the hostname's zone: outside it, or inside a child zone
 * delegated elsewhere, its records would be read from and entered at the wrong DNS host. Such a
 * request is refused; each zone is planned on its own.
 */
async function assertSingleZone(required: { target: Target; zone: Zone; errorPrefix: string }, ports: DnsChangePorts): Promise<void> {
  const { target, zone } = required;
  const misplaced: string[] = [];
  for (const name of requirementNames(target)) {
    const authority = await authorityOf({ name, zone, target, ports });
    if (authority !== zone.zone) misplaced.push(authority === undefined ? `${name} (outside it)` : `${name} (served by the delegated zone ${authority})`);
  }
  if (misplaced.length === 0) return;
  throw new ToolInputError({ message: `${required.errorPrefix}: ${misplaced.join(", ")} is not in the zone ${zone.zone} that serves ${target.hostname}; plan and verify each zone separately.` });
}

/** The zone serving the target, after checking every requirement belongs to it (when one was found). */
async function locateCheckedZone(required: { target: Target; errorPrefix: string }, ports: DnsChangePorts): Promise<Zone> {
  const zone = await locateZone(required.target, ports);
  if (zone.found) await assertSingleZone({ ...required, zone }, ports);
  return zone;
}

function hostBlockers({ hostname, delegation }: { hostname: string; delegation: DelegationCheck | null }, _options = {}): DomainDnsBlocker[] {
  // No delegation is read only when no zone was found.
  if (delegation === null) {
    return [{ code: "zone_not_found", name: hostname, message: `No DNS zone serving ${hostname} could be found, so its current records were not read.`, suggestion: "Check that the domain is registered and has nameservers, then plan again." }];
  }
  if (delegation.state === "delegated") return [];
  // Registrar vs DNS host split: records edited at a host the zone is not delegated to resolve nowhere.
  return [{ code: delegation.state === "not_delegated" ? "not_delegated" : "delegation_unknown", name: delegation.zone, message: delegation.reason }];
}

async function planTarget(required: { target: Target; errorPrefix: string }, ports: DnsChangePorts): Promise<DomainDnsPlan> {
  const { target } = required;
  const zone = await locateCheckedZone(required, ports);
  const delegation = zone.found ? await checkDelegation({ zone: zone.zone, resolver: ports.resolver }) : null;
  const current = delegation?.state === "delegated" ? await listCurrent({ target, zone, ports }) : { records: [], inventory: "unknown" as const };
  const { capabilities } = target.provider;
  const plan = planDnsChanges(
    { providerId: target.providerId, zone: zone.zone, current: current.records, requirements: target.requirements, inventory: current.inventory },
    { apexFlattening: capabilities.apexFlattening, recordTypes: capabilities.recordTypes },
  );
  return { hostname: target.hostname, providerId: target.providerId, zone: zone.zone, zoneFound: zone.found, delegation, plan, blockers: [...hostBlockers({ hostname: target.hostname, delegation }), ...plan.blockers] };
}

/**
 * Plan the record changes that would satisfy the hostname's requirements. Read-only.
 * @complexity O(names · types) DNS reads for the manual provider, then the kernel's O(r·c) plan.
 */
export async function planDomainDns(required: DnsChangeRequest, ports: DnsChangePorts): Promise<DomainDnsPlan> {
  const errorPrefix = "dns_plan";
  return planTarget({ target: await resolveTarget({ ...required, errorPrefix }, ports), errorPrefix }, ports);
}

/** Copyable rows for a person to enter at their DNS host. A blocked plan still lists what is required. */
export async function domainDnsInstructions(required: DnsChangeRequest, ports: DnsChangePorts): Promise<{ planned: DomainDnsPlan; instructions: DnsInstructions }> {
  const errorPrefix = "dns_instructions";
  const target = await resolveTarget({ ...required, errorPrefix }, ports);
  const planned = await planTarget({ target, errorPrefix }, ports);
  return { planned, instructions: instructionsFor(target, planned) };
}

/** The provider's own rendering of the rows when it has one, else the kernel's. */
function instructionsFor(target: Target, planned: DomainDnsPlan): DnsInstructions {
  const input = [{ plan: planned.plan }, { requirements: target.requirements }] as const;
  return target.provider.instructions ? target.provider.instructions(...input) : renderDnsInstructions(...input);
}

/** A read-only look: the plan and rows plus one unsaved check and the last saved binding. */
export interface DomainDnsInspection {
  planned: DomainDnsPlan;
  instructions: DnsInstructions;
  /** `null` when no zone was found, so there are no authoritative nameservers to ask. */
  verification: DnsVerification | null;
  /** The saved tracking state (status, timestamps), or `null` when `dns_verify` never ran for it. */
  binding: DomainBinding | null;
}

/**
 * Plan, rows and one authoritative check of every required record, WITHOUT saving anything
 * (the read-permission view; `verifyDomainDns` stays the single writer of `domain_binding.status`).
 * @complexity The plan's reads plus O(records · nameservers) DNS queries.
 */
export async function inspectDomainDns(required: DnsChangeRequest, ports: DnsChangePorts): Promise<DomainDnsInspection> {
  const errorPrefix = "dns_status";
  const target = await resolveTarget({ ...required, errorPrefix }, ports);
  const planned = await planTarget({ target, errorPrefix }, ports);
  const verification = planned.zoneFound ? await verifyRequirements({ zone: planned.zone, requirements: target.requirements, resolver: ports.resolver }) : null;
  return { planned, instructions: instructionsFor(target, planned), verification, binding: target.binding };
}

const iso = ({ ms }: { ms: number }, _options = {}): string => new Date(ms).toISOString();

/** A propagated check is final; past the 48 h cap anything else is a timeout, reported not hidden. */
function statusFor(required: { state: DnsVerification["state"]; startedAt: string; now: number }): DomainBindingStatus {
  if (required.state === "propagated") return "propagated";
  return isExpired({ startedAt: Date.parse(required.startedAt), now: required.now }) ? "timeout" : required.state;
}

/** New requirements, a new zone or a timed-out binding start a fresh propagation window. */
function restarts({ previous, requirements, zone }: { previous: DomainBinding | null; requirements: DnsPlanRequirement[]; zone: string }, _options = {}): boolean {
  return previous === null || previous.status === "timeout" || previous.zone !== zone
    || canonicalJson({ value: previous.requirements }) !== canonicalJson({ value: requirements });
}

/** Compact, persisted evidence of the last check (no per-nameserver answer dump). */
function summarize(verification: DnsVerification, delegation: DelegationCheck): unknown {
  return {
    state: verification.state, nameservers: verification.nameservers, delegation: delegation.reason,
    ...(verification.reason === undefined ? {} : { reason: verification.reason }),
    records: verification.records.map(({ record, state }) => ({ type: record.type, name: record.name, value: record.value, state })),
  };
}

function nextBinding(required: { target: Target; zone: string; delegation: DelegationCheck; verification: DnsVerification; now: number }): DomainBinding {
  const { target, zone, delegation, verification, now } = required;
  const previous = restarts({ previous: target.binding, requirements: target.requirements, zone }) ? null : target.binding;
  const attempt = previous === null ? 0 : previous.attempt + 1;
  const startedAt = previous === null ? iso({ ms: now }) : previous.startedAt;
  const status = statusFor({ state: verification.state, startedAt, now });
  const done = status === "propagated" || status === "timeout";
  return {
    hostname: target.hostname, providerId: target.providerId, zone, requirements: target.requirements, status,
    delegation: delegation.state, attempt, startedAt, nextCheckAt: done ? null : iso({ ms: now + nextCheckDelayMs({ attempt }) }),
    lastCheckedAt: iso({ ms: now }), lastResult: summarize(verification, delegation), version: (target.binding?.version ?? 0) + 1,
  };
}

export interface DomainDnsVerifyResult {
  binding: DomainBinding;
  delegation: DelegationCheck;
  verification: DnsVerification;
}

type VerifyPorts = DnsChangePorts & { bindings: DomainBindingStore; now: () => number };

/** How often `dns_verify` recomputes after losing a write race before giving up. */
export const VERIFY_WRITE_ATTEMPTS = 3;

/**
 * One check and one compare-and-swap save against the binding version read at the start. `null`
 * when another writer saved the binding while DNS was being read: this observation is stale.
 */
async function verifyOnce(required: DnsChangeRequest, ports: VerifyPorts): Promise<DomainDnsVerifyResult | null> {
  const errorPrefix = "dns_verify";
  const target = await resolveTarget({ ...required, errorPrefix }, ports);
  const { zone } = await locateCheckedZone({ target, errorPrefix }, ports);
  const delegation = await checkDelegation({ zone, resolver: ports.resolver });
  const verification = await verifyRequirements({ zone, requirements: target.requirements, resolver: ports.resolver });
  const now = ports.now();
  const binding = nextBinding({ target, zone, delegation, verification, now });
  const saved = await ports.bindings.put({ binding, now: iso({ ms: now }), expectedVersion: target.binding?.version ?? null });
  return saved ? { binding, delegation, verification } : null;
}

/**
 * Start or continue propagation tracking: save the requirements, check every authoritative
 * nameserver once now, and schedule the next check (30 s doubling to 10 min, 48 h cap).
 * The save is compare-and-swap: when a concurrent check saved first, this one is recomputed from
 * the newer binding (up to {@link VERIFY_WRITE_ATTEMPTS} times) instead of overwriting it.
 * @complexity O(records · nameservers) DNS queries plus one keyed write, per attempt.
 */
export async function verifyDomainDns(required: DnsChangeRequest, ports: VerifyPorts): Promise<DomainDnsVerifyResult> {
  for (let attempt = 1; attempt <= VERIFY_WRITE_ATTEMPTS; attempt += 1) {
    const result = await verifyOnce(required, ports);
    if (result !== null) return result;
  }
  throw new ToolInputError({ message: `dns_verify: ${required.hostname} kept changing while it was being checked (${VERIFY_WRITE_ATTEMPTS} attempts); try again.` });
}

/**
 * One sweep over this workspace's due bindings, oldest first and one at a time (each check is
 * already O(records · nameservers) concurrent queries). Returns the hostnames checked and saved;
 * a binding another writer (e.g. `dns_verify` with new requirements) saved meanwhile is skipped,
 * its newer state standing, and comes due again on its own schedule.
 */
export async function verifyDueDomainBindings(required: { limit: number }, ports: VerifyPorts): Promise<string[]> {
  const due = await ports.bindings.listDue({ now: iso({ ms: ports.now() }), limit: required.limit });
  const checked: string[] = [];
  for (const binding of due) {
    if (await verifyOnce({ hostname: binding.hostname }, ports)) checked.push(binding.hostname);
  }
  return checked;
}
