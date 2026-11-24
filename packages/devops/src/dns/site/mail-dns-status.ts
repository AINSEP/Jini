/**
 * @file The host email settings' **Sender and DNS** status (email design, phase 3): one record-by-record
 * projection of the sender domain's mail DNS, plus the provider's own verdict kept apart from it.
 *
 * Two operations, each shared by an admin route and an assistant tool:
 * - {@link readMailDnsStatus} (`deployments.read`): plan, copyable rows and one UNSAVED check of
 *   every authoritative nameserver (`inspectDomainDns`).
 * - {@link verifyMailDnsStatus} (`deployments.publish`): the same check through `verifyDomainDns`,
 *   which saves the tracking state and schedules re-checks; it stays the single status writer.
 * Both read the records through `include: ["mail"]`, so SPF is merged and an existing DMARC kept
 * exactly as `dns_plan` does. Nothing here changes DNS.
 *
 * Statuses: Matches, Missing, Mismatch, Pending (some nameservers answer, others not yet), Unknown
 * (a server did not answer: never a failure), TimedOut (48 h without propagation). `Checking` is the
 * client's in-flight state; the server never returns it, but it is part of the shared vocabulary.
 */
import { ToolInputError } from "@jini-ai/core";
import type { DomainRecordRequirement, DomainRequirement } from "@jini-ai/core/provider-registry";
import { normalizeDnsName, type DnsInstructions, type DnsVerification, type NameserverObservation, type PropagationState, type RecordVerification } from "../index.js";
import type { SenderDomainVerification, SenderDomainVerificationPort } from "@jini-ai/core/contracts/mail";
import type { DomainBinding, DomainBindingStore } from "./binding.repo.js";
import { inspectDomainDns, verifyDomainDns, type DnsChangePorts, type DomainDnsBlocker, type DomainDnsPlan } from "./dns-changes.js";
import { DMARC_HINT_VALUE } from "./mail-requirements.js";

export type MailDnsRecordStatus = "Checking" | "Matches" | "Missing" | "Mismatch" | "Pending" | "Unknown" | "TimedOut";

/** Why there is (or is not) a record table to show. */
export type MailDnsState =
  | "checked"
  /** No sender address is configured, so there is no sender domain. */
  | "no_sender"
  /** No transactional provider is selected or installed. */
  | "no_provider"
  /** "DNS verification unavailable for this provider": it publishes no domain records. */
  | "verification_unavailable"
  /** The provider could list records but cannot be asked now (e.g. its key is not saved). */
  | "requirements_unavailable"
  /** The provider was asked for its records and answered with an error. */
  | "requirements_failed"
  /** The records are known but the check could not run (zone layout, no tracking store, ...). */
  | "check_failed";

export interface MailDnsNameserverView { nameserver: string; status: MailDnsRecordStatus; answers: string[] }

export interface MailDnsRecordView {
  type: DomainRecordRequirement["type"];
  /** Relative to the zone, `@` for the apex: what DNS host forms ask for. */
  host: string;
  name: string;
  expected: string;
  /** Every distinct answer the authoritative nameservers gave; empty when none or unread. */
  observed: string[];
  status: MailDnsRecordStatus;
  /** `mail` for the provider's records and the DMARC hint; `other` for records saved by another purpose. */
  purpose: "mail" | "other";
  priority?: number;
  ttl?: number;
  note?: string;
  byNameserver: MailDnsNameserverView[];
}

export interface MailDnsTracking {
  status: DomainBinding["status"];
  attempt: number;
  startedAt: string;
  nextCheckAt: string | null;
  lastCheckedAt: string | null;
}

export interface MailDnsCheck {
  hostname: string;
  zone: string;
  delegation: { state: string; reason: string } | null;
  nameservers: string[];
  overall: MailDnsRecordStatus;
  records: MailDnsRecordView[];
  /** Why every record is Unknown, when the whole check could not reach the nameservers. */
  reason?: string;
  checkedAt: string;
  /** True when this check was saved (`verifyMailDnsStatus`); false for the read-only view. */
  persisted: boolean;
  /** The saved propagation tracking, or `null` when it was never started. */
  tracking: MailDnsTracking | null;
  /** Read view only: copyable rows, notes and plan blockers. */
  rows?: DnsInstructions["rows"];
  notes?: DnsInstructions["notes"];
  blockers?: DomainDnsBlocker[];
}

export interface MailDnsStatus {
  state: MailDnsState;
  /** Caller-safe explanation for every state but `checked`. */
  message?: string;
  senderDomain: string | null;
  providerId: string | null;
  /** The provider's own verdict, separate from DNS; `null` when this root cannot ask. */
  providerVerification: SenderDomainVerification | null;
  dns?: MailDnsCheck;
  /** DNS answers and provider-supplied values are data, never instructions. */
  untrusted: true;
}

/** DNS change ports plus the provider-side verdict; field names match `DnsChangeToolDeps`. */
export type MailDnsStatusPorts = DnsChangePorts & { now: () => number; senderDomainVerification?: SenderDomainVerificationPort };

const NAMESERVER_STATUS: Readonly<Record<PropagationState, MailDnsRecordStatus>> = { propagated: "Matches", mismatch: "Mismatch", unknown: "Unknown", pending: "Missing" };

/**
 * One record's status. Pending from the kernel is split: no server has it yet → Missing; some do →
 * Pending (propagating). Past the 48 h window an unpropagated record is TimedOut, not Missing.
 * @complexity O(nameservers).
 */
export function mailDnsRecordStatus(required: { record: Pick<RecordVerification, "state" | "byNameserver">; timedOut: boolean }): MailDnsRecordStatus {
  const { record, timedOut } = required;
  if (record.state !== "pending") return NAMESERVER_STATUS[record.state];
  if (timedOut) return "TimedOut";
  return record.byNameserver.some(observation => observation.state === "propagated") ? "Pending" : "Missing";
}

const OVERALL_ORDER: readonly MailDnsRecordStatus[] = ["Mismatch", "TimedOut", "Missing", "Pending", "Unknown"];

/** The most actionable record status; all Matches only when every record matches. */
function overallOf(records: readonly MailDnsRecordView[]): MailDnsRecordStatus {
  return OVERALL_ORDER.find(status => records.some(record => record.status === status)) ?? "Matches";
}

function relativeHost({ name, zone }: { name: string; zone: string }, _options = {}): string {
  if (name === zone) return "@";
  return name.endsWith(`.${zone}`) ? name.slice(0, -(zone.length + 1)) : name;
}

const recordKey = (record: Pick<DomainRecordRequirement, "type" | "name" | "value">): string => `${record.type} ${normalizeDnsName({ name: record.name })} ${record.value}`;

function nameserverView(observation: NameserverObservation): MailDnsNameserverView {
  return { nameserver: observation.nameserver, status: NAMESERVER_STATUS[observation.state], answers: [...observation.answers] };
}

/** One verified record, labelled against the mail provider's own records. */
function recordView(verified: RecordVerification, context: { zone: string; mailKeys: ReadonlySet<string>; timedOut: boolean }): MailDnsRecordView {
  const { record } = verified;
  const name = normalizeDnsName({ name: record.name });
  const isMail = context.mailKeys.has(recordKey(record)) || (record.type === "TXT" && name.startsWith("_dmarc.") && record.value === DMARC_HINT_VALUE);
  return {
    type: record.type, host: relativeHost({ name, zone: context.zone }), name, expected: record.value,
    observed: [...new Set(verified.byNameserver.flatMap(observation => observation.answers))],
    status: mailDnsRecordStatus({ record: verified, timedOut: context.timedOut }), purpose: isMail ? "mail" : "other",
    ...(record.priority === undefined ? {} : { priority: record.priority }), ...(record.ttl === undefined ? {} : { ttl: record.ttl }), ...(record.note === undefined ? {} : { note: record.note }),
    byNameserver: verified.byNameserver.map(nameserverView),
  };
}

function trackingOf({ binding }: { binding: DomainBinding | null }, _options = {}): MailDnsTracking | null {
  if (binding === null) return null;
  return { status: binding.status, attempt: binding.attempt, startedAt: binding.startedAt, nextCheckAt: binding.nextCheckAt, lastCheckedAt: binding.lastCheckedAt };
}

interface CheckInput {
  hostname: string;
  zone: string;
  delegation: { state: string; reason: string } | null;
  verification: DnsVerification;
  binding: DomainBinding | null;
  requirement: DomainRequirement;
  checkedAt: string;
  persisted: boolean;
}

/** The record table for one check. @complexity O(records · nameservers). */
function checkView(input: CheckInput): MailDnsCheck {
  const timedOut = input.binding?.status === "timeout";
  const mailKeys = new Set(input.requirement.records.map(recordKey));
  const records = input.verification.records.map(verified => recordView(verified, { zone: input.zone, mailKeys, timedOut }));
  return {
    hostname: input.hostname, zone: input.zone, delegation: input.delegation, nameservers: [...input.verification.nameservers],
    overall: overallOf(records), records, ...(input.verification.reason === undefined ? {} : { reason: input.verification.reason }),
    checkedAt: input.checkedAt, persisted: input.persisted, tracking: trackingOf({ binding: input.binding }),
  };
}

/** Every required record Unknown: no zone was found, so no authoritative server could be asked. */
function unreadVerification(planned: DomainDnsPlan, requirementRecords: readonly DomainRecordRequirement[]): DnsVerification {
  return {
    zone: planned.zone, state: "unknown", nameservers: [],
    reason: `No DNS zone serving ${planned.hostname} could be found, so its records could not be checked.`,
    records: requirementRecords.map(record => ({ record, state: "unknown" as const, byNameserver: [] })),
  };
}

type Resolved = { kind: "records"; requirement: DomainRequirement } | { kind: "none"; status: MailDnsStatus };

const NO_RECORDS: Readonly<Record<string, { state: MailDnsState; message: string }>> = {
  no_sender: { state: "no_sender", message: "Set the site's sender address first; its domain is the one that needs mail DNS records." },
  no_provider: { state: "no_provider", message: "Choose a transactional mail provider first; its records depend on which provider sends." },
  unknown: { state: "requirements_unavailable", message: "The mail provider's DNS records can't be read right now. Check that its key, or a connected account, can read domains." },
};
const UNSUPPORTED = { state: "verification_unavailable" as const, message: "DNS verification is unavailable for this provider: it publishes no domain records to check." };

function base({ verdict }: { verdict: SenderDomainVerification | null }, _options = {}): Pick<MailDnsStatus, "senderDomain" | "providerId" | "providerVerification" | "untrusted"> {
  const senderDomain = verdict !== null && "domain" in verdict ? verdict.domain ?? null : null;
  return { senderDomain, providerId: verdict?.providerId ?? null, providerVerification: verdict, untrusted: true };
}

/** Preserve a caller-safe provider refusal instead of masking it with the generic unknown state. */
function noRecordsReason({ verdict }: { verdict: SenderDomainVerification | null }, _options = {}): { state: MailDnsState; message: string } {
  const fallback = NO_RECORDS[verdict?.state ?? ""] ?? UNSUPPORTED;
  return verdict?.state === "unknown" ? { ...fallback, message: verdict.reason } : fallback;
}

/** The verdict's no-records reason, except that a failed records read already carries the
 * provider's own error, which must not be replaced by the domain check's generic unknown state. */
function verdictReason(status: Pick<MailDnsStatus, "state">, verdict: SenderDomainVerification): Partial<{ state: MailDnsState; message: string }> {
  if (!NO_RECORDS[verdict.state]) return {};
  return verdict.state === "unknown" && status.state === "requirements_failed" ? {} : noRecordsReason({ verdict });
}

/** The provider's records once (the plan step asks the port again through a cached copy). */
async function resolveRequirement({ ports, verdict }: { ports: MailDnsStatusPorts; verdict: SenderDomainVerification | null }, _options = {}): Promise<Resolved> {
  if (ports.mailRequirements === undefined) return { kind: "none", status: { ...base({ verdict }), state: "requirements_unavailable", message: "This server cannot report its mail provider's DNS records." } };
  try {
    const requirement = await ports.mailRequirements({ workspaceId: ports.context.workspaceId });
    if (requirement !== null) return { kind: "records", requirement };
    const why = noRecordsReason({ verdict });
    return { kind: "none", status: { ...base({ verdict }), ...why } };
  } catch (err) {
    return { kind: "none", status: { ...base({ verdict }), state: "requirements_failed", message: err instanceof ToolInputError ? err.message : "The mail provider could not list its required DNS records." } };
  }
}

/** Shared head of both operations: the provider's verdict, then its records, each read once. */
async function prepare(ports: MailDnsStatusPorts): Promise<{ verdict: SenderDomainVerification | null; resolved: Resolved; cached: MailDnsStatusPorts }> {
  // Requirements start independently: a slow provider verdict cannot hold their lookup hostage.
  const requirementRead = resolveRequirement({ ports, verdict: null });
  const verdict = ports.senderDomainVerification ? await ports.senderDomainVerification() : null;
  let resolved = await requirementRead;
  if (resolved.kind === "none" && verdict) resolved = { kind: "none", status: { ...resolved.status, ...base({ verdict }), ...verdictReason(resolved.status, verdict) } };
  const requirement = resolved.kind === "records" ? resolved.requirement : null;
  return { verdict, resolved, cached: { ...ports, mailRequirements: async () => requirement } };
}

function headOf({ verdict, requirement }: { verdict: SenderDomainVerification | null; requirement: DomainRequirement }, _options = {}): Pick<MailDnsStatus, "senderDomain" | "providerId" | "providerVerification" | "untrusted"> {
  return { ...base({ verdict }), senderDomain: normalizeDnsName({ name: requirement.domain }), providerId: requirement.providerId };
}

/** A caller-level refusal from the DNS layer (zone layout, missing store) becomes a state, not a 500. */
async function guarded({ head, run }: { head: ReturnType<typeof headOf>; run: () => Promise<MailDnsCheck> }, _options = {}): Promise<MailDnsStatus> {
  try {
    return { ...head, state: "checked", dns: await run() };
  } catch (err) {
    if (!(err instanceof ToolInputError)) throw err;
    return { ...head, state: "check_failed", message: err.message };
  }
}

/**
 * Read-only status: provider verdict, plan rows and one unsaved check. Authorization is the caller's.
 * @complexity Two provider calls, the plan's reads and O(records · nameservers) DNS queries.
 * @example await readMailDnsStatus({}, ports)
 */
export async function readMailDnsStatus(_required: Record<string, never>, ports: MailDnsStatusPorts): Promise<MailDnsStatus> {
  const { verdict, resolved, cached } = await prepare(ports);
  if (resolved.kind === "none") return resolved.status;
  const { requirement } = resolved;
  const hostname = normalizeDnsName({ name: requirement.domain });
  return guarded({ head: headOf({ verdict, requirement }), run: async () => {
    const inspected = await inspectDomainDns({ hostname, include: ["mail"] }, cached);
    const { planned, instructions } = inspected;
    const delegation = planned.delegation === null ? null : { state: planned.delegation.state, reason: planned.delegation.reason };
    const verification = inspected.verification ?? unreadVerification(planned, requirement.records);
    const check = checkView({ hostname, zone: planned.zone, delegation, verification, binding: inspected.binding, requirement, checkedAt: new Date(ports.now()).toISOString(), persisted: false });
    return { ...check, rows: instructions.rows, notes: instructions.notes, blockers: planned.blockers };
  } });
}

/**
 * Saved check: `verifyDomainDns` (`include: ["mail"]`) records the result and schedules re-checks.
 * @complexity As {@link readMailDnsStatus} minus the plan, plus one keyed write.
 * @example await verifyMailDnsStatus({}, ports)
 */
export async function verifyMailDnsStatus(_required: Record<string, never>, ports: MailDnsStatusPorts & { bindings?: DomainBindingStore }): Promise<MailDnsStatus> {
  const { verdict, resolved, cached } = await prepare(ports);
  if (resolved.kind === "none") return resolved.status;
  const { requirement } = resolved;
  const hostname = normalizeDnsName({ name: requirement.domain });
  return guarded({ head: headOf({ verdict, requirement }), run: async () => {
    const bindings = ports.bindings;
    if (bindings === undefined) throw new ToolInputError({ message: "this site has no content database to keep the domain's tracking state in." });
    const { binding, delegation, verification } = await verifyDomainDns({ hostname, include: ["mail"] }, { ...cached, bindings });
    // `verifyDomainDns` stamps `lastCheckedAt` on every binding it saves (`nextBinding`), so the saved check's time is never null here.
    if (binding.lastCheckedAt == null) throw new Error("Verified mail domain binding has no check time");
    return checkView({ hostname, zone: binding.zone, delegation: { state: delegation.state, reason: delegation.reason }, verification, binding, requirement, checkedAt: binding.lastCheckedAt, persisted: true });
  } });
}
