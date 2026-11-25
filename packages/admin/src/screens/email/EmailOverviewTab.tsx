import { agentHandle } from "@jini-ai/core/agent-handles";

import { t } from "./email-i18n.js";
import type { MailTestSendResult, MailUseRow, MailUseState } from "./email-api.types.js";
import { Chip, Loaded, Section, when, type Tone } from "./EmailParts.js";
import type { EmailOverviewController } from "./hooks/use-email-overview.hooks.js";

/**
 * @file Overview's **What uses email** and **Send test email** sections (Status stays in
 * `Email.tsx`). The page shows one at a time (`part`, from its segmented pill); with no `part`
 * both render, as a standalone mount would want. A test result says exactly what happened — accepted by the provider, kept
 * locally, redirected, or failed — never "delivered".
 */

const USE_STATE: Record<MailUseState, { tone: Tone; label: string }> = {
  ready: { tone: "ok", label: "Ready" },
  blocked: { tone: "warning", label: "Blocked" },
  disabled: { tone: "neutral", label: "Off" },
  not_configured: { tone: "neutral", label: "Not configured" },
  unknown: { tone: "neutral", label: "Unknown" },
};

const USE_LABEL: Record<MailUseRow["use"], string> = {
  sign_in: "Sign-in links",
  newsletter_confirmation: "Newsletter confirmations",
  form_notifications: "Form notifications",
  newsletter: "Newsletter",
};

/** Plain words for the readiness codes the server reports; an unknown code shows as itself. */
const REASON: Record<string, string> = {
  sender_not_configured: "No From address is set.",
  durable_outbox_not_ready: "Background sending isn't available on this server yet.",
  mail_delivery_unavailable: "No provider can send yet.",
  no_form_notifications: "No form sends email notifications.",
  sending_enabled_false: "Newsletter sending is off.",
  consent_capability_unbound: "Newsletter consent isn't set up.",
  origin_not_verified: "The site's address isn't verified yet.",
  check_failed: "This check failed. Try again later.",
};

function UseRow(props: { row: MailUseRow; locale: string }) {
  const { row, locale } = props;
  const state = USE_STATE[row.state];
  const evidence = row.evidence;
  return (
    <li className="email-use">
      <div className="email-row">
        <strong className="email-use-name">{t({ locale, key: USE_LABEL[row.use] ?? row.label })}</strong>
        <Chip tone={state.tone}>{t({ locale, key: state.label })}</Chip>
      </div>
      {row.reasons.length > 0 ? (
        <ul className="email-reasons">
          {row.reasons.map((code) => <li key={code} className="jini-field-hint">{REASON[code] ? t({ locale, key: REASON[code] }) : code}</li>)}
        </ul>
      ) : null}
      <span className="jini-field-hint">
        {evidence
          ? t({ locale, key: "Last send: {outcome}, {when}" }).replace("{outcome}", () => evidence.outcome).replace("{when}", () => when({ iso: evidence.at, locale }))
          : t({ locale, key: "No sends yet" })}
      </span>
    </li>
  );
}

/** The one-line truth about a test send. Pure apart from translation. */
export function testResultLine({ result, locale }: { result: MailTestSendResult; locale: string }, _options = {}): { tone: Tone; text: string } {
  switch (result.outcome) {
    case "accepted":
      return { tone: "ok", text: t({ locale, key: "Accepted by the provider for {to}." }).replace("{to}", () => result.to) };
    case "captured":
      return { tone: "neutral", text: t({ locale, key: "Kept on this machine — nothing was sent." }) };
    case "redirected":
      return { tone: "neutral", text: t({ locale, key: "Test mode sent it to {to} instead." }).replace("{to}", () => result.redirectedTo) };
    default:
      return { tone: "error", text: `${t({ locale, key: "Not sent." })} ${result.message}` };
  }
}

export function EmailOverviewTab(props: { controller: EmailOverviewController; locale: string; part?: "uses" | "test" }) {
  const { controller, locale, part } = props;
  return (
    <>
      {part === "test" ? null : <UsesSection controller={controller} locale={locale} hideTitle={part !== undefined} />}
      {part === "uses" ? null : <TestSection controller={controller} locale={locale} hideTitle={part !== undefined} />}
    </>
  );
}

function UsesSection(props: { controller: EmailOverviewController; locale: string; hideTitle: boolean }) {
  const { controller, locale } = props;
  return (
    <Section id="uses" title={t({ locale, key: "What uses email" })} hideTitle={props.hideTitle}>
      <Loaded view={controller.uses} locale={locale} retry={controller.reloadUses}>
        {(report) => (report.uses.length === 0
          ? <p className="jini-field-hint">{t({ locale, key: "Nothing on this site sends email yet." })}</p>
          : <ul className="email-list">{report.uses.map((row) => <UseRow key={row.use} row={row} locale={locale} />)}</ul>)}
      </Loaded>
    </Section>
  );
}

function TestSection(props: { controller: EmailOverviewController; locale: string; hideTitle: boolean }) {
  const { controller, locale } = props;
  const test = controller.test;
  const line = test.kind === "done" ? testResultLine({ result: test.result, locale }) : null;
  return (
    <Section id="test" title={t({ locale, key: "Send test email" })} hideTitle={props.hideTitle}>
      <form className="email-test-form" onSubmit={(event) => { event.preventDefault(); void controller.sendTest(); }}>
        <div className="jini-field email-field">
          <label className="jini-field-label" htmlFor="email-test-to">{t({ locale, key: "To" })}</label>
          <input id="email-test-to" className="jini-input" type="email" value={controller.to} onChange={(e) => controller.setTo(e.target.value)}
            placeholder={t({ locale, key: "Your account address" })} {...agentHandle({ handle: "email-test-to" }, { role: "field", label: "Test email recipient" })} />
        </div>
        <div className="email-row">
          <button type="submit" disabled={test.kind === "sending"} {...agentHandle({ handle: "email-test-send" }, { role: "button", label: "Send a test email" })}>
            {test.kind === "sending" ? t({ locale, key: "Sending…" }) : t({ locale, key: "Send test" })}
          </button>
        </div>
      </form>
      {line && test.kind === "done" ? (
        <div className="email-row" role="status">
          <Chip tone={line.tone}>{when({ iso: test.result.at, locale })}</Chip>
          <span className="jini-field-hint">{line.text}</span>
        </div>
      ) : null}
      {test.kind === "error" ? <p className="jini-field-error" role="alert">{t({ locale, key: test.message })}</p> : null}
      <p className="jini-field-hint">{t({ locale, key: "A test proves the provider accepts mail. It doesn't prove it arrives." })}</p>
    </Section>
  );
}
