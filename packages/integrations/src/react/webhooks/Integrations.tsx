import type { ComponentType, ReactNode } from "react";
import type { AdminWebhookSubscriptionResponse } from "@jini-ai/core/contracts/site/cms-integrations";
import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import { integrationRowMenuItems } from "./rules.js";
import type { IntegrationsController } from "./hooks/use-integrations.hooks.js";

/**
 * @file The Integrations list screen — markup only.
 *
 * State and API calls live in `hooks/use-integrations.hooks.ts`; the row-menu logic lives in
 * `rules.ts`. What stays here is what actually renders: the create form, column definitions, and
 * the confirm copy.
 *
 * `rules.ts`'s row-menu item labels ("Pause"/"Resume"/"Delete") stay English — see
 * `integrations-i18n.tsx`'s file header for why that's a deliberate scope boundary, not an
 * oversight.
 */
type Empty = Record<string, never>;
export interface IntegrationsProps {
  /**
   * Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   * for `useCustomSelect`, and `features/posts/Posts.tsx`'s `usePostsHook`.
   *
   * The host supplies the real hook. A test supplies a stub and drives this component through any state without
   * module mocking or a fake `fetch`.
   */
  useIntegrationsHook: () => IntegrationsController;
  kit: {
    DataTable: ComponentType<{
      rows: readonly AdminWebhookSubscriptionResponse[];
      rowKey: (row: AdminWebhookSubscriptionResponse, index: number) => string;
      empty: ReactNode;
      columns: readonly { key: string; header?: ReactNode; headerLabel?: string; cell: (row: AdminWebhookSubscriptionResponse, index: number) => ReactNode }[];
    }>;
    RowMenu: ComponentType<{ items: ReturnType<typeof integrationRowMenuItems>; triggerLabel: string; agentHandle: string }>;
    ConfirmDialog: ComponentType<{ open: boolean; agentHandle: string; title: string; body: ReactNode; confirmLabel: string; destructive: boolean; pending: boolean; onConfirm: () => void; onCancel: () => void }>;
  };
  ServerLabel: ComponentType<{ value: string }>;
  translate: (required: { locale: string; key: string }, options?: Empty) => string;
  actionsForWebhookLabel: (required: { locale: string; label: string }, options?: Empty) => string;
  deleteWebhookBody: (required: { locale: string; label: string }, options?: Empty) => ReactNode;
}

/** The "Add webhook" form — only rendered while `formOpen`. Top-level rather than an inline
 *  ternary block in `Integrations`'s own body.
 *
 *  Cancel lives here now (2026-09-13, owner: it "floats above the create form" as the header
 *  toggle's other label) — next to Create, at the bottom, the pairing every other admin form on
 *  this build uses (`Collections.tsx`'s `NewContentTypeDialog`, `FormEditor.tsx`'s field-attrs
 *  form). The header toggle above still opens the form and still closes it on click — `onCancel`
 *  calls the exact same setter, just from a second, better-placed control — but while the form is
 *  open the header button is a redundant "Cancel" with no form context floating over an empty
 *  intro line, so `Integrations` below stops rendering it for that state. */
function IntegrationCreateForm(props: {
  locale: string;
  translate: IntegrationsProps["translate"];
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  formError: string | null;
  label: string;
  onLabelChange: (label: string) => void;
  targetUrl: string;
  onTargetUrlChange: (targetUrl: string) => void;
  topics: string;
  onTopicsChange: (topics: string) => void;
  saving: boolean;
}) {
  const { locale, translate: t } = props;
  return (
    <form onSubmit={props.onSubmit} className="notice integrations-form form-measure">
      {props.formError ? <span className="save-error">{props.formError}</span> : null}
      <label>
        {t({ locale: locale, key: "Label" })}
        <input
          value={props.label}
          onChange={(e) => props.onLabelChange(e.target.value)}
          required
          {...agentHandle({ handle: "integrations-create-label" }, { role: "field", label: "New webhook's label" })}
        />
      </label>
      <label>
        {t({ locale: locale, key: "Target URL" })}
        <input
          value={props.targetUrl}
          onChange={(e) => props.onTargetUrlChange(e.target.value)}
          placeholder="https://example.com/hooks"
          required
          {...agentHandle({ handle: "integrations-create-target-url" }, { role: "field", label: "New webhook's target URL" })}
        />
      </label>
      <label>
        {t({ locale: locale, key: "Topics (comma-separated, e.g. post.published, post.*)" })}
        <input
          value={props.topics}
          onChange={(e) => props.onTopicsChange(e.target.value)}
          required
          {...agentHandle({ handle: "integrations-create-topics" }, { role: "field", label: "New webhook's comma-separated event topics" })}
        />
      </label>
      <span className="editor-actions">
        <button
          type="submit"
          disabled={props.saving}
          {...agentHandle({ handle: "integrations-create-submit" }, { role: "button", label: "Create this webhook" })}
        >
          {props.saving ? t({ locale: locale, key: "Saving…" }) : t({ locale: locale, key: "Create" })}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={props.onCancel}
          {...agentHandle({ handle: "integrations-create-cancel" }, { role: "button", label: "Close this form without creating a webhook" })}
        >
          {t({ locale: locale, key: "Cancel" })}
        </button>
      </span>
    </form>
  );
}

/** The delete-webhook confirm dialog. Stays mounted unconditionally (driven by `open`), matching
 *  the `ConfirmDialog` convention `@jini-ai/admin/comments/react`'s `QueuePurgeDialog` also follows. */
function IntegrationDeleteDialog(props: {
  locale: string;
  translate: IntegrationsProps["translate"];
  kit: IntegrationsProps["kit"];
  deleteWebhookBody: IntegrationsProps["deleteWebhookBody"];
  pendingDelete: { label: string } | null;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { locale, translate: t, kit: { ConfirmDialog }, deleteWebhookBody } = props;
  return (
    <ConfirmDialog
      open={props.pendingDelete !== null}
      agentHandle="integrations-delete-webhook"
      title={t({ locale: locale, key: "Delete webhook?" })}
      body={props.pendingDelete ? deleteWebhookBody({ locale: locale, label: props.pendingDelete.label }) : null}
      confirmLabel={t({ locale: locale, key: "Delete" })}
      destructive
      pending={props.deleting}
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    />
  );
}

export function Integrations({ useIntegrationsHook, kit, ServerLabel, translate, actionsForWebhookLabel, deleteWebhookBody }: IntegrationsProps) {
  const {
    subscriptions, error, formOpen, setFormOpen, label, setLabel, targetUrl, setTargetUrl, topics, setTopics, saving, formError, pendingDelete, setPendingDelete,
    deleting, onCreate, onTogglePause, onDelete, t, locale,
  } = useIntegrationsHook();

  if (error) return <div className="notice error">{error}</div>;
  if (!subscriptions) return <div className="notice">{t({ key: "Loading integrations…" })}</div>;

  // Subscription ids are stable and unique, so they disambiguate one row's menu from another's —
  // same reasoning as every other list on this workstream.
  const rowMenuHandles = buildAgentListHandles({ prefix: "integrations-row", ids: subscriptions.map((subscription) => subscription.id) }
  );

  return (
    <div className="integrations-tab-body">
      {/* No `page`/`page-header` of its own since 2026-09-10: this component is a TAB BODY under a
          single page shell — first `DeveloperApi.tsx`'s (that file is now retired), now
          `features/providers/Providers.tsx`'s, which draws the kicker, title and description for
          the whole Integrations page. A tab body that re-declared a page title directly beneath
          the page title it sits under would read as a rendering bug — the same reason
          `AccessTokensTab`/`SiteKeyTab` are headerless under `Security.tsx`'s one shell. The
          description this header used to carry ("Send webhook notifications to external services
          when content on this site changes.") is not lost — it moved to the tab's own intro line
          below, where it still explains the tab without competing with the page title.

          The "Add webhook" control moved with it, from `page-actions` into this row. Same button,
          same handle, same behaviour — only its position changed.

          Withheld while `formOpen` (2026-09-13): with Cancel now living next to Create at the
          form's own bottom (see `IntegrationCreateForm`'s doc comment), a second "Cancel" up here
          would be a duplicate control floating over an intro line that no longer has a form of its
          own to open.

          Capped at `form-measure` (2026-09-13, owner: "the intro sentence, the button, and the
          card all have different widths" — the intro paragraph ran the tab body's full width while
          the create form and the empty-state card both stop at 42rem, so the three read as three
          unrelated objects rather than one column). Same measure, same reason `IntegrationCreateForm`
          and the empty-state `card` below already use it. */}
      {renderIntegrationsIntro({ t, formOpen, setFormOpen })}

      {formOpen ? (
        <IntegrationCreateForm
          translate={translate}
          locale={locale}
          onSubmit={onCreate}
          onCancel={() => setFormOpen(false)}
          formError={formError}
          label={label}
          onLabelChange={setLabel}
          targetUrl={targetUrl}
          onTargetUrlChange={setTargetUrl}
          topics={topics}
          onTopicsChange={setTopics}
          saving={saving}
        />
      ) : null}

      {renderIntegrationsTable({ subscriptions, t, rowMenuHandles, locale, onTogglePause, setPendingDelete, kit, ServerLabel, translate, actionsForWebhookLabel })}
      <IntegrationDeleteDialog
        translate={translate}
        kit={kit}
        deleteWebhookBody={deleteWebhookBody}
        locale={locale}
        pendingDelete={pendingDelete}
        deleting={deleting}
        onConfirm={onDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function renderIntegrationsTable(
  { subscriptions, t, rowMenuHandles, locale, onTogglePause, setPendingDelete, kit, ServerLabel, translate, actionsForWebhookLabel }:
    Pick<ReturnType<NonNullable<IntegrationsProps["useIntegrationsHook"]>>, "t" | "locale" | "onTogglePause" | "setPendingDelete"> &
    { subscriptions: NonNullable<ReturnType<NonNullable<IntegrationsProps["useIntegrationsHook"]>>["subscriptions"]>; rowMenuHandles: ReturnType<typeof buildAgentListHandles> } &
    Pick<IntegrationsProps, "kit" | "ServerLabel" | "translate" | "actionsForWebhookLabel">
) {
  const { DataTable } = kit;
  return (
    <DataTable
      rows={subscriptions}
      rowKey={(subscription) => subscription.id}
      empty={renderIntegrationsEmpty({ t })}
      columns={[
        {
          key: "label",
          header: t({ key: "Label" }),
          cell: (subscription, index) => renderIntegrationLink({ subscription, rowMenuHandles, index }),
        },
        { key: "target-url", header: t({ key: "Target URL" }), cell: (subscription) => subscription.targetUrl },
        {
          key: "status",
          header: t({ key: "Status" }),
          cell: (subscription) => (
            <span className={`status status-sub-${subscription.status}`}><ServerLabel value={subscription.status} /></span>
          ),
        },
        {
          key: "last-delivery",
          header: t({ key: "Last delivery" }),
          cell: (subscription) =>
            subscription.lastDelivery ? (
              <span className={`status status-delivery-${subscription.lastDelivery.status}`}>
                <ServerLabel value={subscription.lastDelivery.status} />
              </span>
            ) : (
              <span className="muted-cell">{t({ key: "never" })}</span>
            ),
        },
        {
          key: "actions",
          headerLabel: t({ key: "Actions" }),
          cell: (subscription, index) =>
            renderIntegrationActions({ subscription, locale, rowMenuHandles, index, onTogglePause, setPendingDelete, kit, translate, actionsForWebhookLabel }),
        },
      ]}
    />
  );
}

function renderIntegrationsEmpty(
  { t }:
    Pick<Parameters<typeof renderIntegrationsTable>[0], "t">
) {
  return (
    // `form-measure` (2026-09-13, owner: this text read off-center and clipped): the card had
    // no width of its own, so on a wide viewport it stretched edge to edge and centered its
    // two sentences around the middle of that whole span instead of around a column a reader
    // could actually see at once. Same cap the create form right above it already uses, so
    // the empty state now reads as that form's own column, just without any webhooks in it.
    //
    // Reopened same day (owner: "sure as hell doesn't look fixed"): `page-description` on the
    // second line was carrying the raw UA `<p>` margin (1em, unscoped — that class only gets
    // rules under `.page-header`, so a bare use here got nothing) on top of `.empty-state`'s
    // own flex gap, which is what put visible daylight between the two lines. `empty-state-
    // title`/`empty-state-hint` below zero that out and give the two lines the hierarchy every
    // other `.empty-state` on this admin gets for free by only ever having ONE line.
    <div className="card form-measure">
      <div className="empty-state">
        <p className="empty-state-title">{t({ key: "No webhooks yet." })}</p>
        <p className="empty-state-hint">{t({ key: "Add one above to start sending event notifications." })}</p>
      </div>
    </div>
  );
}

function renderIntegrationLink(
  { subscription, rowMenuHandles, index }:
    Pick<Parameters<typeof renderIntegrationsTable>[0], "rowMenuHandles"> &
    { subscription: NonNullable<IntegrationsController["subscriptions"]>[number]; index: number }
) {
  return (
    <a
      href={`/admin/addons/integrations/${subscription.id}`}
      {...agentHandle({ handle: `${rowMenuHandles[index]}-label` }, { role: "link", label: `Open the "${subscription.label}" webhook's deliveries` })}
    >
      {subscription.label}
    </a>
  );
}

function renderIntegrationActions(
  { subscription, locale, rowMenuHandles, index, onTogglePause, setPendingDelete, kit, translate, actionsForWebhookLabel }:
    Pick<ReturnType<NonNullable<IntegrationsProps["useIntegrationsHook"]>>, "locale" | "onTogglePause" | "setPendingDelete"> &
    { subscription: NonNullable<IntegrationsController["subscriptions"]>[number]; rowMenuHandles: ReturnType<typeof buildAgentListHandles>; index: number } &
    Pick<IntegrationsProps, "kit" | "translate" | "actionsForWebhookLabel">
) {
  const { RowMenu } = kit;
  return (
    subscription.status === "disabled" ? (
      // `disabled` on both old inline buttons for a `status === "disabled"` row — a
      // built-in-row-style "nothing to do here" case, `RowMenu` has no equivalent
      // per-item `disabled`, so the whole trigger is withheld instead, matching
      // `Roles.tsx`'s built-in-row `—` idiom rather than an unusably empty dropdown.
      <span className="muted-cell">—</span>
    ) : (
      <RowMenu
        triggerLabel={actionsForWebhookLabel({ locale: locale, label: subscription.label })}
        agentHandle={`${rowMenuHandles[index]}-menu`}
        items={integrationRowMenuItems(
          { subscription: subscription,
          handlers: {
            onTogglePause,
            onDelete: setPendingDelete,
          },
          locale: locale, translate },
        )}
      />
    )
  );
}

function renderIntegrationsIntro(
  { t, formOpen, setFormOpen }:
    Pick<ReturnType<NonNullable<IntegrationsProps["useIntegrationsHook"]>>, "t" | "formOpen" | "setFormOpen">
) {
  return (
    <div className="integrations-tab-intro form-measure">
      <p className="page-description">
        {t({ key: "Send webhook notifications to external services when content on this site changes." })}
      </p>
      {formOpen ? null : (
        <div className="page-actions">
          <button
            onClick={() => setFormOpen(true)}
            {...agentHandle({ handle: "integrations-toggle-create-form" }, { role: "button", label: "Open the add-webhook form" })}
          >
            {t({ key: "Add webhook" })}
          </button>
        </div>
      )}
    </div>
  );
}
