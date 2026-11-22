/**
 * @file `include: ["mail"]` for the DNS change tools: the active transactional mail provider's
 * domain records join a hostname's requirements (design override, 2026-10-21: "requirements go to
 * DNS through ports; DNS merges SPF; never overwrite existing SPF/DMARC").
 *
 * The records come only through the `mailRequirements` port (the resolved mailer's
 * `domainRequirements`); this file never talks to a mail provider. SPF needs nothing here: the
 * planner merges it into the zone's one `v=spf1` record. DMARC does: a name may carry only one
 * `v=DMARC1` record and the planner adds TXT values beside existing ones, so a DMARC record the
 * site already publishes is kept and any DMARC the provider asks for is dropped. When neither
 * exists, a monitoring-only hint (`p=none`) is added; when existence cannot be read, nothing is.
 */
import { ToolInputError } from "@jini-ai/core";
import type { DomainRecordRequirement, DomainRequirement } from "@jini-ai/core/provider-registry";
import { normalizeDnsName, settlePort, type DnsPlanRequirement, type DnsProvider, type DnsProviderContext } from "../index.js";

/** What a caller may ask to add to a hostname's requirements. */
export type DnsRequirementInclude = "mail";

/** Who "asked" for the DMARC hint, so a later refresh can replace it. */
export const DMARC_HINT_PROVIDER_ID = "dmarc-hint";

/** Monitoring only: receivers report, nothing is rejected, so it cannot break delivery. */
export const DMARC_HINT_VALUE = "v=DMARC1; p=none";

const DMARC_VALUE = /^v=DMARC1(;|\s|$)/i;

/** Returns the transactional provider's records for the sender domain, or `null` when unconfigured. */
export type MailRequirementsPort = (required: { workspaceId: string }) => Promise<DomainRequirement | null>;

interface MailPorts {
  provider: DnsProvider;
  context: DnsProviderContext;
  mailRequirements?: MailRequirementsPort;
}

function refuse({ prefix, message }: { prefix: string; message: string }, _options = {}): never {
  throw new ToolInputError({ message: `${prefix}: ${message}` });
}

/** Same name, or one inside the other: the hostname's zone can carry the mail domain's records. */
function related({ hostname, domain }: { hostname: string; domain: string }, _options = {}): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`) || domain.endsWith(`.${hostname}`);
}

const isDmarcRecord = ({ name }: { name: string }, _options = {}) => (record: DomainRecordRequirement): boolean =>
  record.type === "TXT" && normalizeDnsName({ name: record.name }) === name && DMARC_VALUE.test(record.value.trim());

/** Whether `name` already publishes DMARC: true, false, or `unknown` when it could not be read. */
async function existingDmarc({ name, ports }: { name: string; ports: MailPorts }, _options = {}): Promise<boolean | "unknown"> {
  const zone = await settlePort({ call: () => ports.provider.findZone(ports.context, { hostname: name }) });
  if (zone.status !== "ok" || zone.value === null) return "unknown";
  const zoneRef = zone.value.ref;
  const listed = await settlePort({ call: () => ports.provider.listRecords(ports.context, { zoneRef, names: [name] }) });
  if (listed.status !== "ok" || listed.value.inventory !== "complete") return "unknown";
  return listed.value.records.some(record => record.type === "TXT" && record.values.some(value => DMARC_VALUE.test(String(value).trim())));
}

/** The provider's requirement with DMARC reconciled against what the zone already has. */
async function withDmarc(mail: DnsPlanRequirement, ports: MailPorts): Promise<DnsPlanRequirement[]> {
  const name = `_dmarc.${mail.domain}`;
  const existing = await existingDmarc({ name, ports });
  if (existing === true) {
    // Never a second DMARC beside the site's own: keep theirs, drop the provider's.
    const records = mail.records.filter(record => !isDmarcRecord({ name })(record));
    return records.length > 0 ? [{ ...mail, records }] : [];
  }
  if (existing === "unknown" || mail.records.some(isDmarcRecord({ name }))) return [mail];
  const hint: DnsPlanRequirement = {
    purpose: "mail", domain: mail.domain, providerId: DMARC_HINT_PROVIDER_ID,
    records: [{ type: "TXT", name, value: DMARC_HINT_VALUE, note: "DMARC in monitoring mode; tighten the policy once reports look clean." }],
  };
  return [mail, hint];
}

/**
 * Append the active mail provider's records for its sender domain to `requirements`, replacing any
 * earlier copy of them (and of the DMARC hint) so a refresh never duplicates. Caller errors when the
 * site cannot report mail requirements or the sender domain is outside the hostname.
 * @complexity One port call, then at most one zone lookup and one record listing.
 */
export async function withMailRequirements(
  required: { hostname: string; requirements: DnsPlanRequirement[]; errorPrefix: string },
  ports: MailPorts,
): Promise<DnsPlanRequirement[]> {
  const { hostname, errorPrefix } = required;
  if (ports.mailRequirements === undefined) refuse({ prefix: errorPrefix, message: "this site cannot report its mail provider's DNS records." });
  const found = await ports.mailRequirements({ workspaceId: ports.context.workspaceId });
  if (found === null) {
    refuse({ prefix: errorPrefix, message: "no mail DNS records are available: choose a transactional mail provider that verifies sending domains (mail_set_provider), save its key, and set the site's sender address (core.mail.senderEmail)." });
  }
  const domain = normalizeDnsName({ name: found.domain });
  if (!related({ hostname, domain })) refuse({ prefix: errorPrefix, message: `the sender domain ${domain} is outside ${hostname}; plan it with hostname ${domain} instead.` });
  const mail: DnsPlanRequirement = { ...found, domain, records: [...found.records] };
  const refreshed = (requirement: DnsPlanRequirement): boolean => requirement.purpose === "mail"
    && normalizeDnsName({ name: requirement.domain }) === domain && [mail.providerId, DMARC_HINT_PROVIDER_ID].includes(requirement.providerId);
  return [...required.requirements.filter(requirement => !refreshed(requirement)), ...(await withDmarc(mail, ports))];
}
