import { useCallback, useState } from "react";
import type { AdminWebhookSubscriptionResponse } from "@jini-ai/core/contracts/site/cms-integrations";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import { KEYS, WEBHOOKS_RESOURCE, parseTopics, visibleIntegrationsError } from "../rules.js";

type Empty = Record<string, never>;

export interface IntegrationsPort {
  listIntegrationSubscriptions(): Promise<{ subscriptions: AdminWebhookSubscriptionResponse[] }>;
  createIntegrationSubscription(input: {
    label: string;
    targetUrl: string;
    topics: string[];
  }, optional?: Record<string, never>): Promise<{ subscription: AdminWebhookSubscriptionResponse }>;
  pauseIntegrationSubscription(target: {
    id: string;
    paused: boolean;
  }): Promise<{ subscription: AdminWebhookSubscriptionResponse }>;
  deleteIntegrationSubscription(required: { id: string }, optional?: Record<string, never>): Promise<{ subscription: AdminWebhookSubscriptionResponse }>;
}

/**
 * @file Everything the Integrations LIST screen does, so `Integrations.tsx` is only markup.
 *
 * Extracted verbatim — same state, same order, same effect, same error strings. Naming follows
 * `hooks/use-settings-slice.hooks.ts` and `features/posts/hooks/use-posts.hooks.ts`:
 * `use-<thing>.hooks.ts`. Feature-local because nothing outside `features/integrations` needs it.
 *
 * `port` is injected — see `integrations-port.hooks.ts` — rather than importing `lib/api`
 * directly, so a test can describe list/write outcomes against `createFakeIntegrationsPort`
 * instead of stubbing global `fetch`. The host `useWiredIntegrations` binding is the zero-argument pair
 * `Integrations.tsx` actually mounts.
 *
 * `t`/`locale` (2026-08-11, standing i18n rule — a component with a hook gets a BOUND `t` from
 * that hook, not its own `useAdminLocale()`/dictionary import): injected as required arguments.
 * Unlike `use-analytics.hooks.ts`'s `t`-only case, `locale` is ALSO threaded
 * through here — `Integrations.tsx` passes raw `locale` (not just `t`) into `integrationRowMenuItems`
 * (`rules.ts`) and `actionsForWebhookLabel`/`deleteWebhookBody` (`integrations-i18n.tsx`), all three
 * of which take `locale` directly rather than a bound translator, so the component still
 * needs the raw value — see `wired-hooks-convention.md`'s own "locale only where genuinely needed"
 * phrasing. `useIntegrations` itself never calls `t`/reads `locale` internally — both exist solely
 * to hand through to the component, same as the port.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the list read is `useFetchQuery({ key: KEYS.list, ...
 * })`; `create`/`togglePause`/`delete` are three independent `useFetchMutation`s that each
 * `invalidates: [KEYS.list]` — same three-independent-writes shape `Jini packages/admin/src/redirects/react/hooks/use-
 * redirects.hooks.ts` (the pilot) established. `formError` (the create form's own inline error) is
 * a direct read of `createMutation.error` — it needs no `clearOtherWriteErrors` treatment since it
 * has no sibling on that channel and a mutation's own `.error` clears itself the next time `mutate`
 * is called. `error` (the page-level banner) DOES need it, mirroring `Jini redirects/SOURCE-RATIONALE.md`'s
 * `clearOtherWriteErrors`: toggle/delete are two independent mutations sharing that one channel, so
 * a stale failure from one must not survive past the start of the other.
 *
 * `useContentRefreshSubscription` (staleness-bug generalization pass — see that hook's own header):
 * re-invalidates `KEYS.list` on an out-of-band content-refresh notification — today an assistant
 * run that called `webhooks_create_subscription`/`webhooks_pause_subscription`/
 * `webhooks_delete_subscription` (the host's `features/webhooks/agent-tools.ts`) — the same
 * one-line adoption `use-media.hooks.ts` uses. The create form's `label`/`targetUrl`/`topics` local
 * state is untouched by an invalidate (it only replaces `list.data`), so an in-progress "new
 * subscription" draft survives a background refresh.
 */

export interface IntegrationsController {
  subscriptions: AdminWebhookSubscriptionResponse[] | null;
  error: string | null;
  formOpen: boolean;
  setFormOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  label: string;
  setLabel: (label: string) => void;
  targetUrl: string;
  setTargetUrl: (targetUrl: string) => void;
  topics: string;
  setTopics: (topics: string) => void;
  saving: boolean;
  formError: string | null;
  /** The subscription a `RowMenu` "Delete" selection is asking to confirm; `null` when the dialog
   *  is shut. */
  pendingDelete: AdminWebhookSubscriptionResponse | null;
  setPendingDelete: (subscription: AdminWebhookSubscriptionResponse | null) => void;
  deleting: boolean;
  onCreate: (e: React.FormEvent) => Promise<void>;
  onTogglePause: (subscription: AdminWebhookSubscriptionResponse) => Promise<void>;
  onDelete: () => Promise<void>;
  /** Bound translator — `key` already resolved against the caller's locale, so `Integrations.tsx`
   *  never imports `useAdminLocale`/`integrations-i18n` itself. See this file's header. */
  t: (required: { key: string }, optional?: Record<string, never>) => string;
  /** Raw resolved locale — needed alongside `t` because `rules.ts`/`integrations-i18n.tsx` expose
   *  a few helpers that take `(locale, ...)` directly rather than a bound translator. See this
   *  file's header. */
  locale: string;
}


export function useIntegrations({ port, t, locale, queryHooks, useContentRefreshSubscriptionHook, describeApiError, translate }: { port: IntegrationsPort; queryHooks: Pick<FetchQueryAdapter, "useFetchQuery" | "useFetchMutation" | "useInvalidate">; useContentRefreshSubscriptionHook: (required: { resource: string; onRefresh: () => void }, options?: Empty) => void; describeApiError: (required: { e: unknown; fallback: string }, options?: Empty) => string; translate: (required: { locale: string; key: string }, options?: Empty) => string; t: (required: { key: string }, optional?: Record<string, never>) => string; locale: string }, _optional = {}): IntegrationsController {
  const {
    list, formOpen, setFormOpen, label, setLabel, targetUrl, setTargetUrl, topics, setTopics, pendingDelete, setPendingDelete, createMutation, toggleMutation,
    deleteMutation,
  } = useIntegrationsState({ port, queryHooks, useContentRefreshSubscriptionHook });
  const { onCreate, onTogglePause, onDelete } = createIntegrationActions({
    toggleMutation, deleteMutation, createMutation, label, targetUrl, topics, setLabel, setTargetUrl, setTopics, setFormOpen, pendingDelete, setPendingDelete,
  });

  const subscriptions = list.data?.subscriptions ?? null;
  const formError = createMutation.error ? describeApiError({ e: createMutation.error, fallback: "failed to create subscription" }) : null;
  const error = visibleIntegrationsError({
    toggleError: toggleMutation.error,
    deleteError: deleteMutation.error,
    listError: list.error,
    hasSubscriptions: subscriptions !== null,
    locale,
    translate,
    describeApiError,
  });

  return {
    subscriptions,
    error,
    formOpen,
    setFormOpen,
    label,
    setLabel,
    targetUrl,
    setTargetUrl,
    topics,
    setTopics,
    saving: createMutation.status === "pending",
    formError,
    pendingDelete,
    setPendingDelete,
    deleting: deleteMutation.status === "pending",
    onCreate,
    onTogglePause,
    onDelete,
    t,
    locale,
  };
}

function createIntegrationActions(
  { toggleMutation, deleteMutation, createMutation, label, targetUrl, topics, setLabel, setTargetUrl, setTopics, setFormOpen, pendingDelete, setPendingDelete }:
    Pick<ReturnType<typeof useIntegrationsState>, "toggleMutation" | "deleteMutation" | "createMutation" | "label" | "targetUrl" | "topics" | "setLabel"
    | "setTargetUrl" | "setTopics" | "setFormOpen" | "pendingDelete" | "setPendingDelete">
) {
  // Only toggle/delete share the page-level `error` banner below — see this file's own header for
  // why `createMutation`'s failure has no sibling to clear here (it drives `formError` alone).
  function clearOtherPageErrors(active: { reset: () => void }) {
    for (const write of [toggleMutation, deleteMutation]) if (write !== active) write.reset();
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createMutation.mutate({ input: { label, targetUrl, topics: parseTopics({ raw: topics }) } });
      setLabel("");
      setTargetUrl("");
      setTopics("");
      setFormOpen(false);
    } catch {
      // already surfaced through createMutation.error -> formError below
    }
  }

  async function onTogglePause(subscription: AdminWebhookSubscriptionResponse) {
    clearOtherPageErrors(toggleMutation);
    try {
      await toggleMutation.mutate({ input: subscription });
    } catch {
      // already surfaced through toggleMutation.error -> error below
    }
  }

  /** Confirmation now gates via a `ConfirmDialog` modal, reached through `RowMenu`'s "Delete" item
   *  (`setPendingDelete` below), rather than `window.confirm` — see `Roles.tsx`'s `onDeleteRole`
   *  comment for why a `RowMenu` item needs `ConfirmDialog`, not a blocking browser prompt, to hold
   *  the confirm step. Copy is the exact previous sentence, unchanged. */
  async function onDelete() {
    if (!pendingDelete) return;
    const subscription = pendingDelete;
    clearOtherPageErrors(deleteMutation);
    try {
      await deleteMutation.mutate({ input: subscription.id });
    } catch {
      // already surfaced through deleteMutation.error -> error below
    } finally {
      setPendingDelete(null);
    }
  }
  return { onCreate, onTogglePause, onDelete };
}

function useIntegrationsState(
  { port, queryHooks: { useFetchQuery, useFetchMutation, useInvalidate }, useContentRefreshSubscriptionHook }:
    Pick<Parameters<typeof useIntegrations>[0], "port" | "queryHooks" | "useContentRefreshSubscriptionHook">
) {
  const list = useFetchQuery({ key: KEYS.list, fetch: () => port.listIntegrationSubscriptions() });

  // Stable identity (not an inline arrow) so `useContentRefreshSubscription`'s own effect does not
  // unsubscribe/resubscribe on every render — see `use-media.hooks.ts`'s identical `invalidateList`
  // note.
  const invalidate = useInvalidate();
  const invalidateList = useCallback(() => invalidate({ key: KEYS.list }), [invalidate]);
  useContentRefreshSubscriptionHook({ resource: WEBHOOKS_RESOURCE, onRefresh: invalidateList });

  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [topics, setTopics] = useState("");
  // The subscription a `RowMenu` "Delete" selection is asking to confirm — `null` when the dialog
  // is closed. `ConfirmDialog` stays mounted unconditionally in the view (see its own doc comment
  // on why); this is what drives its `open` prop.
  const [pendingDelete, setPendingDelete] = useState<AdminWebhookSubscriptionResponse | null>(null);

  const createMutation = useFetchMutation({
    run: ({ input }: { input: { label: string; targetUrl: string; topics: string[] } }) => port.createIntegrationSubscription(input),
  }, {
    invalidates: [KEYS.list],
  });
  const toggleMutation = useFetchMutation({
    run: ({ input: subscription }: { input: AdminWebhookSubscriptionResponse }) =>
      port.pauseIntegrationSubscription({ id: subscription.id, paused: subscription.status !== "paused" }),
  }, {
    invalidates: [KEYS.list],
  });
  const deleteMutation = useFetchMutation({
    run: ({ input: id }: { input: string }) => port.deleteIntegrationSubscription({ id }),
  }, {
    invalidates: [KEYS.list],
  });
  return {
    list, formOpen, setFormOpen, label, setLabel, targetUrl, setTargetUrl, topics, setTopics, pendingDelete, setPendingDelete, createMutation, toggleMutation,
    deleteMutation,
  };
}

