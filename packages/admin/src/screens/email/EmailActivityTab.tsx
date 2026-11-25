import { ConfirmDialog } from "../../react/components/ConfirmDialog/ConfirmDialog.js";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { pickPlural } from "@jini-ai/core/text";

import { t } from "./email-i18n.js";
import type { MailActivityItem, MailSuppressionEntry } from "./email-api.types.js";
import type { MailFeedbackProviderSetup } from "@jini-ai/core/contracts/site/platform-mail";
import { Chip, CopyButton, Loaded, Section, when, type Tone } from "./EmailParts.js";
import type { CaptureClearState, EmailActivityController, PagedList } from "./hooks/use-email-activity.hooks.js";

/**
 * @file The Activity tab: recent sends (filters, Load more, one send's feedback), blocked
 * addresses (search; Remove asks for a reason, then shows what removal means before the final
 * confirm — the server records the reason and only lets the owner do it), and whether provider
 * feedback (bounces, complaints) reaches this site. The page shows one section at a time (`part`,
 * from its segmented pill); with no `part` all three render. Recent sends also offers the owner
 * "Clear captured test messages" (previewed, then a confirm card with the count).
 */

const OUTCOMES = ["accepted", "delivered", "bounced", "complained", "suppressed", "deferred", "failed", "unknown", "captured"] as const;

const OUTCOME: Record<string, { tone: Tone; label: string }> = {
  accepted: { tone: "ok", label: "Accepted" },
  delivered: { tone: "ok", label: "Delivered" },
  bounced: { tone: "error", label: "Bounced" },
  complained: { tone: "error", label: "Marked as spam" },
  suppressed: { tone: "warning", label: "Blocked" },
  deferred: { tone: "warning", label: "Delayed" },
  failed: { tone: "error", label: "Failed" },
  unknown: { tone: "neutral", label: "Unknown" },
  captured: { tone: "neutral", label: "Kept locally" },
};

const USE: Record<string, string> = {
  sign_in: "Sign-in link",
  newsletter_confirmation: "Newsletter confirmation",
  form_notification: "Form notification",
  newsletter: "Newsletter",
  test: "Test",
  unknown: "Other",
};

const SUPPRESSION_REASON: Record<MailSuppressionEntry["reason"], string> = {
  bounced: "Bounced",
  complained: "Marked as spam",
  manual: "Added by hand",
};

const FEEDBACK_STATE: Record<MailFeedbackProviderSetup["state"], { tone: Tone; label: string }> = {
  receiving: { tone: "ok", label: "Receiving" },
  no_events_yet: { tone: "neutral", label: "No events yet" },
  secret_missing: { tone: "warning", label: "Signing secret not saved" },
  unsupported: { tone: "neutral", label: "Not supported by this provider" },
};

function LoadMore<T>(props: { list: PagedList<T>; locale: string; handle: string }) {
  const { list, locale } = props;
  if (list.view.kind !== "loaded" || !list.view.data.nextCursor) return list.moreError ? <p className="jini-field-error">{t({ locale, key: list.moreError })}</p> : null;
  return (
    <div className="jini-admin-email-row">
      <button type="button" className="btn-secondary" disabled={list.loadingMore} onClick={() => void list.loadMore()} {...agentHandle({ handle: props.handle }, { role: "button", label: "Load more rows" })}>
        {list.loadingMore ? t({ locale, key: "Loading…" }) : t({ locale, key: "Load more" })}
      </button>
      {list.moreError ? <span className="jini-field-error">{t({ locale, key: list.moreError })}</span> : null}
    </div>
  );
}

function ActivityRow(props: { item: MailActivityItem; controller: EmailActivityController; locale: string; index: number }) {
  const { item, controller, locale } = props;
  const itemId = item.id;
  const outcome = OUTCOME[item.outcome] ?? { tone: "neutral" as const, label: item.outcome };
  const open = item.id !== undefined && controller.openId === item.id;
  const detail = open ? controller.detail : null;
  return (
    <li className="jini-admin-email-activity">
      <div className="jini-admin-email-row jini-admin-email-activity-row">
        <Chip tone={outcome.tone}>{t({ locale, key: outcome.label })}</Chip>
        <span className="jini-admin-email-activity-what">
          <span className="jini-admin-email-activity-recipient">{item.recipient}</span>
          <span className="jini-field-hint">{t({ locale, key: USE[item.use] ?? item.use })} · {when({ iso: item.createdAt, locale })}</span>
        </span>
        {itemId ? (
          <button type="button" className="btn-secondary jini-admin-email-push-end" aria-expanded={open} onClick={() => controller.toggleDetail(itemId)}
            {...agentHandle({ handle: `email-activity-${props.index}-details` }, { role: "button", label: "Show this send's details" })}>
            {open ? t({ locale, key: "Hide details" }) : t({ locale, key: "Details" })}
          </button>
        ) : null}
      </div>
      {detail ? (
        <div className="jini-admin-email-activity-detail">
          <Loaded view={detail} locale={locale}>
            {(data) => (
              <dl className="jini-admin-email-facts">
                <div className="jini-admin-email-fact"><dt className="jini-field-label">{t({ locale, key: "Provider" })}</dt><dd>{data.activity.providerId}</dd></div>
                {data.activity.originalRecipient ? (
                  <div className="jini-admin-email-fact"><dt className="jini-field-label">{t({ locale, key: "Meant for" })}</dt><dd>{data.activity.originalRecipient}</dd></div>
                ) : null}
                {data.activity.errorCode ? <div className="jini-admin-email-fact"><dt className="jini-field-label">{t({ locale, key: "Error" })}</dt><dd><code>{data.activity.errorCode}</code>{data.activity.message ? <p>{data.activity.message}</p> : null}</dd></div> : null}
                {data.activity.providerMessageId ? <div className="jini-admin-email-fact"><dt className="jini-field-label">{t({ locale, key: "Message ID" })}</dt><dd><code>{data.activity.providerMessageId}</code></dd></div> : null}
                <div className="jini-admin-email-fact">
                  <dt className="jini-field-label">{t({ locale, key: "Feedback" })}</dt>
                  <dd>
                    {data.feedback.length === 0
                      ? <span className="jini-field-hint">{t({ locale, key: "None received yet" })}</span>
                      : data.feedback.map((event, i) => <span key={i} className="jini-field-hint">{t({ locale, key: OUTCOME[event.kind]?.label ?? event.kind })} · {when({ iso: event.receivedAt, locale })}</span>)}
                  </dd>
                </div>
              </dl>
            )}
          </Loaded>
        </div>
      ) : null}
    </li>
  );
}

/** The words under the button: nothing to clear, how many were cleared, or why it did not work. */
function CaptureNotice(props: { state: CaptureClearState; locale: string }) {
  const { state, locale } = props;
  if (state.kind === "empty") return <p className="jini-field-hint" role="status">{t({ locale, key: "No captured test messages to clear. Email Activity records are kept separately." })}</p>;
  if (state.kind === "cleared") {
    // The noun agrees with the count, so each form is its own dictionary key (a locale with no written
    // singular reuses its one translation for both).
    const key = pickPlural({ count: state.deleted, forms: { one: "Cleared {count} captured test message.", other: "Cleared {count} captured test messages." } });
    return <p className="jini-field-hint" role="status">{t({ locale, key }).replace("{count}", () => String(state.deleted))}</p>;
  }
  if (state.kind === "error") return <p className="jini-field-error" role="alert">{t({ locale, key: state.message })}</p>;
  return null;
}

/**
 * "Clear captured test messages": owner-only (`controller.capture.canClear`), previewed first, then a confirm
 * card that names how many will go; only the captured test messages are deleted, never sent-mail records.
 * A delivery record can remain after its message copy is gone, or exist without a message copy at all.
 */
function CaptureClear(props: { controller: EmailActivityController; locale: string }) {
  const { controller, locale } = props;
  const { capture } = controller;
  if (!capture.canClear) return null;
  const step = capture.state.kind === "confirm" ? capture.state : null;
  return (
    <div className="email-capture-clear">
      <div className="jini-admin-email-row">
        <button type="button" className="btn-secondary" disabled={capture.state.kind === "checking"} onClick={() => void capture.start()}
          {...agentHandle({ handle: "email-capture-clear" }, { role: "button", label: "Clear all captured test messages" })}>
          {t({ locale, key: capture.state.kind === "checking" ? "Checking…" : "Clear captured test messages" })}
        </button>
      </div>
      <CaptureNotice state={capture.state} locale={locale} />
      <ConfirmDialog
        open={step !== null}
        agentHandle="email-capture-clear-confirm"
        title={t({ locale, key: "Clear all captured test messages?" })}
        body={step ? (
          <div className="jini-admin-email-removal">
            <p>{t({ locale, key: "Captured test messages: {count}. This deletes their saved copies, not Email Activity records. This cannot be undone." }).replace("{count}", () => String(step.plan.count))}</p>
            {step.error ? <p className="jini-field-error" role="alert">{t({ locale, key: step.error })}</p> : null}
          </div>
        ) : null}
        confirmLabel={t({ locale, key: "Clear" })}
        destructive
        pending={step?.pending ?? false}
        onConfirm={() => void capture.confirm()}
        onCancel={capture.cancel}
      />
    </div>
  );
}

function RecentSends(props: { controller: EmailActivityController; locale: string; hideTitle: boolean }) {
  const { controller, locale } = props;
  return (
    <Section id="activity" title={t({ locale, key: "Recent sends" })} hideTitle={props.hideTitle}>
      <div className="jini-admin-email-filters">
        <select className="jini-input" aria-label={t({ locale, key: "Outcome" })} value={controller.filter.outcome ?? ""}
          onChange={(e) => controller.setFilter({ ...controller.filter, outcome: e.target.value || undefined })}
          {...agentHandle({ handle: "email-activity-outcome" }, { role: "field", label: "Filter sends by outcome" })}>
          <option value="">{t({ locale, key: "All outcomes" })}</option>
          {OUTCOMES.map((value) => {
            const outcome = OUTCOME[value];
            if (!outcome) throw new Error(`email activity outcome ${value} is missing`);
            return <option key={value} value={value}>{t({ locale, key: outcome.label })}</option>;
          })}
        </select>
        <input className="jini-input" type="search" aria-label={t({ locale, key: "Recipient" })} placeholder={t({ locale, key: "Search by recipient" })}
          value={controller.filter.recipient ?? ""} onChange={(e) => controller.setFilter({ ...controller.filter, recipient: e.target.value })}
          {...agentHandle({ handle: "email-activity-recipient" }, { role: "field", label: "Filter sends by recipient address" })} />
      </div>
      <CaptureClear controller={controller} locale={locale} />
      <Loaded view={controller.activity.view} locale={locale} retry={controller.activity.reload}>
        {(page) => (
          <>
            {page.access === "masked" ? <p className="jini-field-hint">{t({ locale, key: "Addresses are partly hidden for your role." })}</p> : null}
            {page.items.length === 0 ? (
              <p className="jini-field-hint">{t({ locale, key: page.empty === "no_matches" ? "No sends match." : "No sends recorded yet." })}</p>
            ) : (
              <ul className="jini-admin-email-list">{page.items.map((item, i) => <ActivityRow key={item.id ?? `${item.createdAt}-${i}`} item={item} controller={controller} locale={locale} index={i} />)}</ul>
            )}
          </>
        )}
      </Loaded>
      <LoadMore list={controller.activity} locale={locale} handle="email-activity-more" />
    </Section>
  );
}

function RemovalBody(props: { controller: EmailActivityController; locale: string }) {
  const { controller, locale } = props;
  const step = controller.removal;
  if (!step) return null;
  if (step.kind === "reason") {
    return (
      <div className="jini-admin-email-removal">
        <p>{t({ locale, key: "{address} won't be blocked anymore. Why?" }).replace("{address}", () => step.entry.address)}</p>
        <label className="jini-field-label" htmlFor="email-removal-reason">{t({ locale, key: "Reason (kept in the record)" })}</label>
        <textarea id="email-removal-reason" className="jini-input" rows={3} value={step.reason} onChange={(e) => controller.setRemovalReason(e.target.value)}
          {...agentHandle({ handle: "email-removal-reason" }, { role: "field", label: "Why this address may get email again" })} />
        {step.error ? <p className="jini-field-error" role="alert">{t({ locale, key: step.error })}</p> : null}
      </div>
    );
  }
  return (
    <div className="jini-admin-email-removal">
      <p>
        {t({ locale, key: "Blocked since {when} ({why})." }).replace("{when}", () => when({ iso: step.plan.suppressedAt, locale })).replace("{why}", () => t({ locale, key: SUPPRESSION_REASON[step.plan.suppressionReason] }))}
      </p>
      <ul className="jini-admin-email-reasons">{step.plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      <p className="jini-field-hint">{t({ locale, key: "Reason: {reason}" }).replace("{reason}", () => step.plan.reason)}</p>
      {step.error ? <p className="jini-field-error" role="alert">{t({ locale, key: step.error })}</p> : null}
    </div>
  );
}

function BlockedAddresses(props: { controller: EmailActivityController; locale: string; hideTitle: boolean }) {
  const { controller, locale } = props;
  const step = controller.removal;
  const removedNotice = controller.removedNotice;
  return (
    <Section id="blocked" title={t({ locale, key: "Blocked addresses" })} hideTitle={props.hideTitle}>
      <p className="jini-field-hint">{t({ locale, key: "Addresses that bounced, marked mail as spam, or were blocked by hand. Nothing is sent to them." })}</p>
      <input className="jini-input" type="search" aria-label={t({ locale, key: "Search blocked addresses" })} placeholder={t({ locale, key: "Search blocked addresses" })}
        value={controller.search} onChange={(e) => controller.setSearch(e.target.value)}
        {...agentHandle({ handle: "email-blocked-search" }, { role: "field", label: "Search blocked addresses" })} />
      {removedNotice ? <p className="jini-field-hint" role="status">{t({ locale, key: "{address} can get email again." }).replace("{address}", () => removedNotice)}</p> : null}
      <Loaded view={controller.suppressions.view} locale={locale} retry={controller.suppressions.reload}>
        {(page) => (page.items.length === 0 ? (
          <p className="jini-field-hint">{t({ locale, key: page.empty === "no_matches" ? "No blocked addresses match." : "No blocked addresses." })}</p>
        ) : (
          <ul className="jini-admin-email-list">
            {page.items.map((entry, i) => (
              <li key={`${entry.address}-${entry.scope}`} className="jini-admin-email-row jini-admin-email-blocked">
                <span className="jini-admin-email-activity-recipient">{entry.address}</span>
                <Chip tone={entry.reason === "manual" ? "neutral" : "warning"}>{t({ locale, key: SUPPRESSION_REASON[entry.reason] })}</Chip>
                <span className="jini-field-hint">{t({ locale, key: entry.scope === "bulk" ? "Newsletters only" : "All email" })} · {when({ iso: entry.createdAt, locale })}</span>
                <button type="button" className="btn-secondary jini-admin-email-push-end" onClick={() => controller.startRemoval(entry)}
                  {...agentHandle({ handle: `email-blocked-${i}-remove` }, { role: "button", label: `Unblock ${entry.address}` })}>
                  {t({ locale, key: "Unblock" })}
                </button>
              </li>
            ))}
          </ul>
        ))}
      </Loaded>
      <LoadMore list={controller.suppressions} locale={locale} handle="email-blocked-more" />
      <ConfirmDialog
        open={step !== null}
        agentHandle="email-blocked-remove"
        title={t({ locale, key: step?.kind === "confirm" ? "Unblock this address?" : "Unblock an address" })}
        body={<RemovalBody controller={controller} locale={locale} />}
        confirmLabel={t({ locale, key: step?.kind === "confirm" ? "Unblock" : "Continue" })}
        destructive={step?.kind === "confirm"}
        pending={step?.pending ?? false}
        onConfirm={() => void controller.continueRemoval()}
        onCancel={controller.cancelRemoval}
      />
    </Section>
  );
}

function FeedbackSetup(props: { controller: EmailActivityController; locale: string; hideTitle: boolean }) {
  const { controller, locale } = props;
  return (
    <Section id="feedback" title={t({ locale, key: "Bounce and spam reports" })} hideTitle={props.hideTitle}>
      <Loaded view={controller.feedback} locale={locale}>
        {(report) => (!report.available || report.providers.length === 0 ? (
          <p className="jini-field-hint">{t({ locale, key: "No active provider reports bounces here." })}</p>
        ) : (
          <ul className="jini-admin-email-list">
            {report.providers.map((provider) => {
              const state = FEEDBACK_STATE[provider.state];
              const lastVerifiedEvent = provider.lastVerifiedEvent;
              return (
                <li key={provider.providerId} className="jini-admin-email-provider">
                  <div className="jini-admin-email-row">
                    <strong className="jini-admin-email-provider-name">{provider.label}</strong>
                    <Chip tone={state.tone}>{t({ locale, key: state.label })}</Chip>
                  </div>
                  {provider.supported && provider.webhookUrl ? (
                      <div className="jini-admin-email-row">
                        <span className="jini-field-label">{t({ locale, key: "Webhook URL" })}</span>
                        <code className="jini-admin-email-break">{provider.webhookUrl}</code>
                        <CopyButton text={provider.webhookUrl} label={t({ locale, key: "{provider} webhook URL" }).replace("{provider}", () => provider.label)} locale={locale} handle={`email-feedback-${provider.providerId}-copy`} />
                      </div>
                  ) : null}
                  {provider.supported && !provider.webhookUrl ? (
                    <span className="jini-field-hint">{t({ locale, key: "Verify the site's address first; the webhook URL needs it." })}</span>
                  ) : null}
                  {lastVerifiedEvent ? (
                    <span className="jini-field-hint">{t({ locale, key: "Last report: {when}" }).replace("{when}", () => when({ iso: lastVerifiedEvent.receivedAt, locale }))}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ))}
      </Loaded>
    </Section>
  );
}

export function EmailActivityTab(props: { controller: EmailActivityController; locale: string; part?: "sends" | "blocked" | "reports" }) {
  const { controller, locale, part } = props;
  return (
    <>
      {part === undefined || part === "sends" ? <RecentSends controller={controller} locale={locale} hideTitle={part !== undefined} /> : null}
      {part === undefined || part === "blocked" ? <BlockedAddresses controller={controller} locale={locale} hideTitle={part !== undefined} /> : null}
      {part === undefined || part === "reports" ? <FeedbackSetup controller={controller} locale={locale} hideTitle={part !== undefined} /> : null}
    </>
  );
}
