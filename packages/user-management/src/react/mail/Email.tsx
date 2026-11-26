import type { ReactElement, ReactNode } from 'react';
import { agentHandle } from '@jini-ai/core/agent-handles';
import { resolveActiveTabId } from '@jini-ai/core/text';
import { EmailProviderTab } from './EmailProviderTab.js';
import { Segments } from './EmailSegments.js';
import type {
  EmailCopy, EmailKit, EmailProviderChoice, EmailProviderView, EmailNavigate, EmailParts, EmailRules, EmailStatusControl, EmailStatusShape, EmailStatusView, EmailSummary, EmailTabHooks, EmailTabId,
  EmailThemeBoundaryHook, EmailTone, EmailTypes,
} from './email-view.types.js';

/**
 * @file The mail screen — markup only; every tab's state comes from the host's hooks.
 *
 * Each tab's state is its own hook (`tabHooks`), mounted only while that tab shows so the page does
 * not fire every read at once. No provider-name branches: everything shown comes from the server's
 * data. A template's editor is its own page (`EmailTemplateEditor.tsx`).
 *
 * Tabs (overview | provider | sender | templates | activity) render through the host's `TabBar`; the
 * host's URL owns the selection (`tabId`), so a reload or a link lands on that tab. The host owns the
 * URL shape: this screen only calls `navigate({ tabId, part })`.
 *
 * Inside Overview, Provider, Sender & DNS and Activity, a segmented pill shows one section at a time
 * (owner, 2026-10-22: the stacked cards were too much to take in). The host's URL owns that choice
 * too, as `part`: an Overview section, a provider id, `sender`/`dns`, or an Activity section. A
 * missing or unknown `part` falls back to the first section (Provider: the active provider — see
 * `EmailProviderTab.tsx`).
 */

const TAB_IDS = ['overview', 'provider', 'sender', 'templates', 'activity'] as const satisfies readonly EmailTabId[];
const TAB_LABELS: Record<EmailTabId, string> = {
  overview: 'Overview',
  provider: 'Provider',
  sender: 'Sender & DNS',
  templates: 'Templates',
  activity: 'Activity',
};

const OVERVIEW_PARTS = ['status', 'uses', 'test'] as const;
type OverviewPart = (typeof OVERVIEW_PARTS)[number];
const OVERVIEW_PART_LABELS: Record<OverviewPart, string> = { status: 'Status', uses: 'What uses email', test: 'Send test email' };
const SENDER_PARTS = ['sender', 'dns'] as const;
type SenderPart = (typeof SENDER_PARTS)[number];
const SENDER_PART_LABELS: Record<SenderPart, string> = { sender: 'Sender', dns: 'DNS' };
const ACTIVITY_PARTS = ['sends', 'blocked', 'reports'] as const;
type ActivityPart = (typeof ACTIVITY_PARTS)[number];
const ACTIVITY_PART_LABELS: Record<ActivityPart, string> = { sends: 'Recent sends', blocked: 'Blocked addresses', reports: 'Bounce and spam reports' };

/** `p` when it names one of `parts`, else the first. Pure. */
function pickPart<T extends string>({ parts, part }: { parts: readonly T[]; part: string | null | undefined }, _options = {}): T {
  const selected = parts.find((id) => id === part) ?? parts[0];
  if (selected === undefined) throw new Error('email section has no available parts');
  return selected;
}

/** A segmented pill over fixed parts, labelled through the dictionary. */
function PartSegments<T extends string, S extends EmailStatusShape>(props: { name: string; label: string; labels: Record<T, string>; active: T; locale: string; onSelect: (part: string) => void; kit: EmailKit<S>; copy: EmailCopy }) {
  const items = (Object.keys(props.labels) as T[]).map((key) => ({ key, label: props.copy.t({ locale: props.locale, key: props.labels[key] }) }));
  return <Segments name={props.name} label={props.label} items={items} active={props.active} onSelect={props.onSelect} Segmented={props.kit.Segmented} />;
}

const SUMMARY: Record<EmailSummary, { tone: EmailTone; chip: string; line: string }> = {
  not_set_up: {
    tone: 'warning',
    chip: 'Not set up',
    line: 'No mail provider is selected, so sign-in links, confirmations and form notifications are not sent.',
  },
  no_external_delivery: {
    tone: 'neutral',
    chip: 'No external delivery',
    line: 'Mail is only written to the server log. Nothing is sent.',
  },
  needs_attention: { tone: 'warning', chip: 'Needs attention', line: 'Some mail cannot be sent. Check the Provider and Sender & DNS tabs.' },
  configured: { tone: 'ok', chip: 'Configured', line: 'A provider is selected and its key is saved.' },
};

type StatusBodyProps<S extends EmailStatusShape> = { view: EmailStatusView<S>; locale: string; retry: () => void; kit: EmailKit<S>; copy: EmailCopy; rules: Pick<EmailRules<S, EmailProviderView, EmailProviderChoice>, 'summarize'> };

function StatusBody<S extends EmailStatusShape>(props: StatusBodyProps<S>) {
  const { view, locale, kit, copy } = props;
  if (view.kind === 'loading') return <p className="jini-field-hint" role="status">{copy.t({ locale, key: 'Loading email status…' })}</p>;
  if (view.kind === 'forbidden') return <p className="jini-field-hint">{copy.t({ locale, key: "You don't have permission to view email status." })}</p>;
  if (view.kind === 'error') {
    return (
      <div className="email-row" role="alert">
        <kit.Chip tone="warning">{copy.t({ locale, key: 'Status unavailable' })}</kit.Chip>
        <button type="button" className="btn-secondary" onClick={props.retry} {...agentHandle({ handle: 'email-status-retry' }, { role: 'button', label: 'Retry the email status read' })}>
          {copy.t({ locale, key: 'Retry' })}
        </button>
      </div>
    );
  }
  const summary = SUMMARY[props.rules.summarize({ status: view.status })];
  return (
    <>
      <div className="email-row">
        <kit.Chip tone={summary.tone}>{copy.t({ locale, key: summary.chip })}</kit.Chip>
        <span className="jini-field-hint">{copy.t({ locale, key: summary.line })}</span>
      </div>
      <kit.StatusFacts status={view.status} locale={locale} />
      <p className="jini-field-hint">{copy.t({ locale, key: 'This checks configuration only. It does not prove that mail arrives.' })}</p>
    </>
  );
}

type PartProps<T extends EmailTypes> = {
  hooks: EmailTabHooks<T>; locale: string; part: string | null | undefined; kit: EmailKit<T['status']>; copy: EmailCopy; parts: EmailParts<T>;
  onPart: (required: { next: string }, optional?: Record<string, never>) => void;
};

/** Overview's hook stays mounted across its segments, so the uses read and a typed test address survive a switch. */
function OverviewTab<T extends EmailTypes>(props: PartProps<T> & { label: string; status: ReactNode }) {
  const controller = props.hooks.overview();
  const part = pickPart({ parts: OVERVIEW_PARTS, part: props.part });
  const { Overview } = props.parts;
  return (
    <>
      <PartSegments name="email-overview-part" label={props.label} labels={OVERVIEW_PART_LABELS} active={part} locale={props.locale} onSelect={(next) => props.onPart({ next })} kit={props.kit} copy={props.copy} />
      {part === 'status' ? props.status : <Overview controller={controller} locale={props.locale} part={part} />}
    </>
  );
}
function ProviderTab<T extends EmailTypes>(props: PartProps<T> & { status: EmailStatusControl<T['status']>; rules: EmailRules<T['status'], T['provider'], T['choice']> }) {
  const controller = props.hooks.provider({ onChanged: props.status.retry });
  return (
    <EmailProviderTab controller={controller} status={props.status.view.kind === 'loaded' ? props.status.view.status : null} locale={props.locale}
      selectedId={props.part} onSelect={(next) => props.onPart({ next })} kit={props.kit} copy={props.copy} rules={props.rules} />
  );
}
function SenderTab<T extends EmailTypes>(props: PartProps<T> & { label: string; status: EmailStatusControl<T['status']> }) {
  const controller = props.hooks.sender({ onChanged: props.status.retry });
  const part = pickPart({ parts: SENDER_PARTS, part: props.part });
  const { Sender } = props.parts;
  return (
    <>
      <PartSegments name="email-sender-part" label={props.label} labels={SENDER_PART_LABELS} active={part} locale={props.locale} onSelect={(next) => props.onPart({ next })} kit={props.kit} copy={props.copy} />
      <Sender controller={controller} warnings={props.status.view.kind === 'loaded' ? props.status.view.status.warnings ?? [] : []} locale={props.locale} part={part} />
    </>
  );
}
function TemplatesTab<T extends EmailTypes>(props: PartProps<T>) {
  const { Templates } = props.parts;
  return <Templates controller={props.hooks.templates({ newName: props.copy.t({ locale: props.locale, key: 'Untitled email' }) })} locale={props.locale} />;
}
/** Activity's hook stays mounted across its segments, so filters, searches and loaded pages survive a switch. */
function ActivityTab<T extends EmailTypes>(props: PartProps<T> & { label: string }) {
  const controller = props.hooks.activity();
  const part = pickPart({ parts: ACTIVITY_PARTS, part: props.part });
  const { Activity } = props.parts;
  return (
    <>
      <PartSegments name="email-activity-part" label={props.label} labels={ACTIVITY_PART_LABELS} active={part} locale={props.locale} onSelect={(next) => props.onPart({ next })} kit={props.kit} copy={props.copy} />
      <Activity controller={controller} locale={props.locale} part={part} />
    </>
  );
}

export interface EmailProps<T extends EmailTypes> {
  readonly tabId?: string | null | undefined; readonly part?: string | null | undefined;
  readonly useEmailHook: () => EmailStatusControl<T['status']>;
  readonly tabHooks: EmailTabHooks<T>;
  readonly useAdminThemeBoundaryHook: EmailThemeBoundaryHook;
  readonly parts: EmailParts<T>;
  readonly kit: EmailKit<T['status']>;
  readonly copy: EmailCopy;
  readonly rules: EmailRules<T['status'], T['provider'], T['choice']>;
  readonly navigate: EmailNavigate;
}

/** The tab whose id is `next`, or undefined for an id this screen does not know. Pure. */
function knownTabId({ next }: { next: string }, _options = {}): EmailTabId | undefined {
  return TAB_IDS.find((id) => id === next);
}

/** The active tab's body. Only that tab's hook mounts. */
function ActiveTab<T extends EmailTypes>(props: { activeId: EmailTabId; partProps: PartProps<T>; controller: EmailStatusControl<T['status']>; rules: EmailRules<T['status'], T['provider'], T['choice']> }) {
  const { activeId, partProps, controller } = props;
  const { locale, copy, kit } = partProps;
  const tabLabel = (id: EmailTabId) => copy.t({ locale, key: TAB_LABELS[id] });
  if (activeId === 'provider') return <ProviderTab {...partProps} status={controller} rules={props.rules} />;
  if (activeId === 'sender') return <SenderTab {...partProps} label={tabLabel('sender')} status={controller} />;
  if (activeId === 'templates') return <TemplatesTab {...partProps} />;
  if (activeId === 'activity') return <ActivityTab {...partProps} label={tabLabel('activity')} />;
  return (
    <OverviewTab {...partProps} label={tabLabel('overview')} status={(
      <kit.Section id="status" title={copy.t({ locale, key: 'Status' })} hideTitle>
        <StatusBody view={controller.view} locale={locale} retry={controller.retry} kit={kit} copy={copy} rules={props.rules} />
      </kit.Section>
    )} />
  );
}

/**
 * The mail screen. `tabId` is the host's tab selection and `part` the section shown inside that tab;
 * every hook, component, dictionary and rule is the host's, injected through props.
 */
export function Email<T extends EmailTypes>(props: EmailProps<T>): ReactElement {
  const controller = props.useEmailHook();
  const { locale } = controller;
  const { kit, copy } = props;
  const themeBoundary = props.useAdminThemeBoundaryHook({}, {});
  const activeId = resolveActiveTabId({ tabId: props.tabId, validIds: TAB_IDS, defaultId: 'overview' });
  const tabs = TAB_IDS.map((id) => ({
    id, label: copy.t({ locale, key: TAB_LABELS[id] }), handle: `email-tab-${id}`, handleLabel: `Switch to the ${TAB_LABELS[id]} tab of Email`,
  }));
  const partProps: PartProps<T> = {
    hooks: props.tabHooks, locale, part: props.part, kit, copy, parts: props.parts,
    onPart: ({ next }, _options = {}) => props.navigate({ tabId: activeId, part: next }),
  };
  const onTab = (next: string) => {
    const tabId = knownTabId({ next });
    if (tabId !== undefined) props.navigate({ tabId, part: null });
  };
  return (
    <div className="page email-page">
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">{copy.navLabel({ locale, key: 'Administration' })}</p>
          <h1 className="page-title">{copy.navLabel({ locale, key: 'Email' })}</h1>
          <p className="page-description">
            {copy.t({ locale, key: 'Sign-in links, confirmations and form notifications depend on email.' })}
          </p>
        </div>
      </div>
      <kit.TabBar ariaLabel={copy.navLabel({ locale, key: 'Email' })} tabs={tabs} activeId={activeId} onChange={onTab} containerHandle="email-tab-bar" />
      {/* Same wrapper classes as the host's other settings pages: `settings-ui-section` + the theme
          boundary is what gives `.jini-settings-section-card` its themed panel. */}
      <div className="settings-ui-section settings-ui-section--page-flow email-sections" {...themeBoundary}>
        <ActiveTab activeId={activeId} partProps={partProps} controller={controller} rules={props.rules} />
      </div>
    </div>
  );
}
