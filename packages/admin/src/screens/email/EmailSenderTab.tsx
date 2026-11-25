import { agentHandle } from "@jini-ai/core/agent-handles";

import { t } from "./email-i18n.js";
import type { MailDnsRecordStatus, MailDnsStatus } from "./email-api.types.js";
import { Chip, CopyButton, Loaded, Section, when, type Tone } from "./EmailParts.js";
import type { EmailSenderController } from "./hooks/use-email-sender.hooks.js";

/**
 * @file The Sender & DNS tab: the From name and address (saved settings; the next email uses
 * them), then the sender domain's DNS records with copy buttons and **Check again**. "Unknown" is
 * never shown as a failure; the provider's own verdict is shown apart from the DNS answers. The page
 * shows one card at a time (`part`, from its segmented pill); with no `part` both render.
 */

const RECORD_STATUS: Record<MailDnsRecordStatus, { tone: Tone; label: string }> = {
  Matches: { tone: "ok", label: "Matches" },
  Missing: { tone: "error", label: "Missing" },
  Mismatch: { tone: "error", label: "Mismatch" },
  Pending: { tone: "warning", label: "Pending" },
  Checking: { tone: "neutral", label: "Checking" },
  Unknown: { tone: "neutral", label: "Unknown" },
  TimedOut: { tone: "neutral", label: "Timed out" },
};

const PROVIDER_VERDICT: Record<string, { tone: Tone; label: string }> = {
  verified: { tone: "ok", label: "Verified by the provider" },
  pending: { tone: "warning", label: "The provider is still verifying" },
  failed: { tone: "error", label: "The provider could not verify it" },
  not_found: { tone: "warning", label: "Not added at the provider yet" },
};

/** Why there is no record table, in plain words. */
const STATE_LINE: Record<MailDnsStatus["state"], string> = {
  checked: "",
  no_sender: "Set a From address first.",
  no_provider: "Choose a provider first.",
  verification_unavailable: "DNS verification is unavailable for this provider.",
  requirements_unavailable: "The provider can't be asked for its records right now.",
  requirements_failed: "The provider answered with an error.",
  check_failed: "The records are known, but the check couldn't run.",
};

/** States whose line already says what the server's `message` says — showing both repeated it. */
const LINE_SAYS_IT_ALL: ReadonlySet<MailDnsStatus["state"]> = new Set(["no_sender", "no_provider", "verification_unavailable"]);

function SenderForm(props: { controller: EmailSenderController; locale: string }) {
  const { controller, locale } = props;
  const state = controller.saveState;
  return (
    <form className="jini-admin-email-provider-form" onSubmit={(event) => { event.preventDefault(); void controller.save(); }}>
      <div className="jini-field jini-admin-email-field">
        <label className="jini-field-label" htmlFor="email-sender-name">{t({ locale, key: "Name" })}</label>
        <input id="email-sender-name" className="jini-input" value={controller.draft.name} onChange={(e) => controller.setDraft({ name: e.target.value })}
          placeholder={t({ locale, key: "Your site's name" })} {...agentHandle({ handle: "email-sender-name" }, { role: "field", label: "Sender display name" })} />
      </div>
      <div className="jini-field jini-admin-email-field">
        <label className="jini-field-label" htmlFor="email-sender-email">{t({ locale, key: "From address" })}</label>
        <input id="email-sender-email" className="jini-input" type="email" value={controller.draft.email} onChange={(e) => controller.setDraft({ email: e.target.value })}
          placeholder="hello@example.com" aria-invalid={typeof state === "object"} {...agentHandle({ handle: "email-sender-email" }, { role: "field", label: "Sender From address" })} />
      </div>
      <div className="jini-admin-email-row">
        <button type="submit" disabled={!controller.dirty || state === "saving"} {...agentHandle({ handle: "email-sender-save" }, { role: "button", label: "Save the sender" })}>
          {state === "saving" ? t({ locale, key: "Saving…" }) : t({ locale, key: "Save" })}
        </button>
        {state === "saved" ? <span className="jini-field-hint" role="status">{t({ locale, key: "Saved" })}</span> : null}
        {typeof state === "object" ? <span className="jini-field-error" role="alert">{t({ locale, key: state.error })}</span> : null}
      </div>
    </form>
  );
}

function Records(props: { dns: NonNullable<MailDnsStatus["dns"]>; locale: string }) {
  const { dns, locale } = props;
  if (dns.records.length === 0) return <p className="jini-field-hint">{t({ locale, key: "This provider needs no DNS records." })}</p>;
  return (
    <ul className="jini-admin-email-list email-dns">
      {dns.records.map((record, index) => {
        const status = RECORD_STATUS[record.status] ?? { tone: "neutral" as const, label: record.status };
        const key = `${record.type}-${record.host}-${index}`;
        return (
          <li key={key} className="jini-admin-email-dns-record">
            <div className="jini-admin-email-row">
              <Chip tone={status.tone}>{t({ locale, key: status.label })}</Chip>
              <strong>{record.type}</strong>
              {record.priority !== undefined ? <span className="jini-field-hint">{t({ locale, key: "Priority" })} {record.priority}</span> : null}
            </div>
            <dl className="jini-admin-email-dns-values">
              <div className="jini-admin-email-dns-value">
                <dt className="jini-field-label">{t({ locale, key: "Host" })}</dt>
                <dd><code>{record.host}</code><CopyButton text={record.host} label={t({ locale, key: "{type} host" }).replace("{type}", () => record.type)} locale={locale} handle={`email-dns-${index}-copy-host`} /></dd>
              </div>
              <div className="jini-admin-email-dns-value">
                <dt className="jini-field-label">{t({ locale, key: "Value" })}</dt>
                <dd><code>{record.expected}</code><CopyButton text={record.expected} label={t({ locale, key: "{type} value" }).replace("{type}", () => record.type)} locale={locale} handle={`email-dns-${index}-copy-value`} /></dd>
              </div>
              {record.status === "Mismatch" && record.observed.length > 0 ? (
                <div className="jini-admin-email-dns-value">
                  <dt className="jini-field-label">{t({ locale, key: "Found" })}</dt>
                  <dd><code>{record.observed.join(" · ")}</code></dd>
                </div>
              ) : null}
            </dl>
            {record.note ? <span className="jini-field-hint">{record.note}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The same provider verdict is shown on Overview and Sender & DNS. */
export function SenderDomain(props: { status: Pick<MailDnsStatus, "senderDomain" | "providerVerification">; locale: string }) {
  const { status, locale } = props;
  if (!status.senderDomain) return null;
  const verdict = status.providerVerification ? PROVIDER_VERDICT[status.providerVerification.state] : undefined;
  return (
    <div className="jini-admin-email-row">
      <span className="jini-field-label">{t({ locale, key: "Domain" })}</span>
      <code>{status.senderDomain}</code>
      {verdict ? <Chip tone={verdict.tone}>{t({ locale, key: verdict.label })}</Chip> : null}
      {status.providerVerification?.state === "unknown" && status.providerVerification.reason ? <p className="jini-field-hint">{status.providerVerification.reason}</p> : null}
    </div>
  );
}

function DnsBody(props: { status: MailDnsStatus; locale: string }) {
  const { status, locale } = props;
  const dns = status.state === "checked" ? status.dns : undefined;
  return (
    <>
      <SenderDomain status={status} locale={locale} />
      {dns ? (
        <>
          <Records dns={dns} locale={locale} />
          {dns.reason ? <p className="jini-field-hint">{dns.reason}</p> : null}
          <p className="jini-field-hint">{t({ locale, key: "Checked {when}" }).replace("{when}", () => when({ iso: dns.checkedAt, locale }))}</p>
        </>
      ) : (
        <p className="jini-field-hint">{[t({ locale, key: STATE_LINE[status.state] || "No DNS check yet." }), LINE_SAYS_IT_ALL.has(status.state) ? undefined : status.message].filter(Boolean).join(" ")}</p>
      )}
    </>
  );
}

const SENDER_WARNING: Record<string, string> = {
  sender_unknown: "No sender address is set.",
  sender_unverified: "The provider has not verified the sender's domain.",
};

function DnsSection(props: { controller: EmailSenderController; locale: string; hideTitle: boolean }) {
  const { controller, locale } = props;
  const canCheck = controller.dns.kind === "loaded" && controller.dns.data.state === "checked";
  const check = canCheck ? (
    <button type="button" className="btn-secondary" disabled={controller.checking} onClick={() => void controller.checkAgain()}
      {...agentHandle({ handle: "email-dns-check" }, { role: "button", label: "Check the sender domain's DNS records again" })}>
      {t({ locale, key: controller.checking ? "Checking…" : "Check again" })}
    </button>
  ) : null;
  return (
    <Section id="dns" title={t({ locale, key: "DNS" })} hideTitle={props.hideTitle} actions={check}>
      <Loaded view={controller.dns} locale={locale}>
        {(status) => <DnsBody status={status} locale={locale} />}
      </Loaded>
      {controller.checkError ? <p className="jini-field-error" role="alert">{t({ locale, key: controller.checkError })}</p> : null}
    </Section>
  );
}

function SenderSection(props: { controller: EmailSenderController; warnings?: readonly string[] | undefined; locale: string; hideTitle: boolean }) {
  const { controller, locale } = props;
  return (
    <Section id="sender" title={t({ locale, key: "Sender" })} hideTitle={props.hideTitle}>
      {(props.warnings ?? []).map((warning) => (
        <div key={warning} className="jini-admin-email-row">
          <Chip tone="warning">{t({ locale, key: "Needs attention" })}</Chip>
          <span className="jini-field-hint">{t({ locale, key: SENDER_WARNING[warning] ?? warning })}</span>
        </div>
      ))}
      <Loaded view={controller.sender} locale={locale}>
        {() => <SenderForm controller={controller} locale={locale} />}
      </Loaded>
    </Section>
  );
}

export function EmailSenderTab(props: { controller: EmailSenderController; warnings?: readonly string[]; locale: string; part?: "sender" | "dns" }) {
  const { controller, locale, part } = props;
  return (
    <>
      {part === "dns" ? null : <SenderSection controller={controller} warnings={props.warnings} locale={locale} hideTitle={part !== undefined} />}
      {part === "sender" ? null : <DnsSection controller={controller} locale={locale} hideTitle={part !== undefined} />}
    </>
  );
}
