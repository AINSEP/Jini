import type { FormDestinationAddress, FormDestinationKit, FormDestinationModule, FormDestinationPage, RemoteFormSubmission } from "../index.js";

/**
 * @file Pulls a form destination's pending submissions into the host, page by page, and acknowledges
 * only the rows the import committed, so a row is never lost between the receiver and the host: an
 * unacknowledged row is simply pulled again and the import's receipts absorb the repeat. Generic:
 * the destination is any module that implements `pull` and `ack`.
 */
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_PAGE_SIZE = 50;

/** The longest one receiver request may wait during a pull. A module's own, longer timeout is cut to
 * this, so the pull's duration is bounded by the host rather than by whichever plugin is installed. */
export const FORM_PULL_REQUEST_TIMEOUT_MS = 15_000;

/** Wall-clock time after which a pull starts no further page (it reports `hasMore` instead). A time
 * budget, not a request count: a module may make any number of requests per page. */
export const FORM_PULL_BUDGET_MS = 300_000;

/** Covers the last page's import (local store work, ≤ 50 rows) and clock drift between processes. */
const FORM_PULL_LEASE_MARGIN_MS = 60_000;

/**
 * How long a pull holds its receiver's lease (`withFormPullLease`). It must outlast the slowest pull,
 * or a second pull could start on the same receiver while the first is still importing.
 * Proof: no page starts after {@link FORM_PULL_BUDGET_MS}; every request the pull's kit makes waits
 * at most until budget + one request (15 s), and a request asked for after that is refused at once.
 * So all network waiting ends by 315 s, and what can follow is the local import of the page in
 * hand, which the margin covers: 375 s. An expired lease is free again, so a crashed pull blocks the
 * receiver for at most this long. Pinned by `__tests__/pull.unit.test.ts`.
 */
export const FORM_PULL_LEASE_MS = FORM_PULL_BUDGET_MS + FORM_PULL_REQUEST_TIMEOUT_MS + FORM_PULL_LEASE_MARGIN_MS;

/** The import step, injected so this module stays independent of the forms feature. */
export type FormDestinationImportPort<R extends { readonly committedIds: readonly string[] }> =
  (required: { readonly items: readonly RemoteFormSubmission[]; readonly destinationKey: string }) => Promise<R>;

/** Stable identity of one receiver for dedupe: its scope and origin. @complexity O(1). */
export function formDestinationKey({ scope, url }: { scope: string; url: string }, _optional = {}): string {
  return `${scope}:${new URL(url).origin}`;
}

/**
 * Pull, import, acknowledge, for up to `maxPages` pages and {@link FORM_PULL_BUDGET_MS}. `hasMore`
 * stays true when the page cap or the time budget stopped the loop, so the caller can say "pull
 * again". Errors name the address, never the key.
 * @param optional.now the wall clock in ms (default `Date.now`), for tests.
 * @complexity O(maxPages * pageSize) rows; two module calls per page.
 */
export async function pullFromFormDestination<R extends { readonly committedIds: readonly string[] }>(
  required: { module: Pick<FormDestinationModule, "pull" | "ack">; scope: string; destination: FormDestinationAddress; kit: FormDestinationKit; importPage: FormDestinationImportPort<R> },
  optional: { maxPages?: number; pageSize?: number; now?: () => number } = {},
): Promise<{ destinationKey: string; pulled: number; acknowledged: number; hasMore: boolean; pages: R[] }> {
  const { module, scope, destination, importPage } = required;
  const { maxPages = DEFAULT_MAX_PAGES, pageSize: limit = DEFAULT_PAGE_SIZE, now = Date.now } = optional;
  const budgetEndsMs = now() + FORM_PULL_BUDGET_MS;
  const kit = boundedKit({ kit: required.kit, now, deadlineMs: budgetEndsMs + FORM_PULL_REQUEST_TIMEOUT_MS });
  const { pull, ack } = module;
  if (!pull || !ack) throw new Error(`no installed form destination returns submissions for ${scope}. Turn on the plugin that provides it (or republish the site to a host that receives forms), then pull again.`);
  const destinationKey = formDestinationKey({ scope, url: destination.url });
  const report = { destinationKey, pulled: 0, acknowledged: 0, hasMore: false, pages: [] as R[] };
  try {
    await pullPages({ report, maxPages, outOfTime: () => now() >= budgetEndsMs,
      pullPage: ({ after }) => pull.call(module, { kit, destination }, { after, limit }),
      importPage: ({ items }) => importPage({ items, destinationKey }),
      acknowledge: ({ ids }) => ack.call(module, { kit, destination, ids }) });
  } catch (error) {
    throw pullStopped({ error, destination });
  }
  return report;
}

/** The page loop: pull, import, acknowledge, until the host has no more rows, `maxPages`, or
 * `outOfTime`. Fills `report`; `hasMore` stays as the last page said when the cap or the clock stops
 * the loop. @throws whatever a step throws. @complexity O(maxPages) steps. */
async function pullPages<R extends { readonly committedIds: readonly string[] }>(required: {
  report: { pulled: number; acknowledged: number; hasMore: boolean; pages: R[] };
  maxPages: number;
  outOfTime: () => boolean;
  pullPage: (required: { after: number }) => Promise<FormDestinationPage>;
  importPage: (required: { items: readonly RemoteFormSubmission[] }) => Promise<R>;
  acknowledge: (required: { ids: readonly string[] }) => Promise<{ readonly acknowledged: number }>;
}): Promise<void> {
  const { report } = required;
  let after = 0;
  for (let page = 0; page < required.maxPages; page += 1) {
    // Out of time: the rows still waiting are the next pull's, exactly as when the page cap stops.
    if (required.outOfTime()) return;
    const batch = await required.pullPage({ after });
    report.hasMore = batch.hasMore;
    if (batch.items.length === 0) return;
    report.pulled += batch.items.length;
    const imported = await required.importPage({ items: batch.items });
    report.pages.push(imported);
    report.acknowledged += await acknowledgeCommitted({ acknowledge: required.acknowledge, committedIds: imported.committedIds });
    after = batch.nextAfter;
    if (!batch.hasMore) return;
  }
}

/** The caller's kit with every request's timeout capped at {@link FORM_PULL_REQUEST_TIMEOUT_MS} and at
 * the time left before `deadlineMs`; a request asked for after the deadline is refused unsent.
 * @complexity O(1). */
function boundedKit({ kit, now, deadlineMs }: { kit: FormDestinationKit; now: () => number; deadlineMs: number }, _optional = {}): FormDestinationKit {
  return { ...kit, fetch: (url, init, options) => {
    const leftMs = deadlineMs - now();
    if (leftMs <= 0) return Promise.reject(new Error(`the pull used up its ${FORM_PULL_BUDGET_MS / 1000} s time budget`));
    return kit.fetch(url, init, { ...options, timeoutMs: Math.min(options.timeoutMs, FORM_PULL_REQUEST_TIMEOUT_MS, leftMs) });
  } };
}

/** Acknowledges each committed id once; no request when nothing was committed. @complexity O(ids). */
async function acknowledgeCommitted(
  required: { acknowledge: (required: { ids: readonly string[] }) => Promise<{ readonly acknowledged: number }>; committedIds: readonly string[] },
  _optional: Record<string, never> = {},
): Promise<number> {
  const ids = [...new Set(required.committedIds)];
  return ids.length > 0 ? (await required.acknowledge({ ids })).acknowledged : 0;
}

/** The person-facing stop error: names the address, never the key. @complexity O(message bytes). */
function pullStopped({ error, destination }: { error: unknown; destination: FormDestinationAddress }, _optional = {}): Error {
  const message = (error instanceof Error ? error.message : String(error)).replaceAll(destination.secret, "[redacted]");
  // `cause` keeps the original stack for the server log; the caller redacts the key before logging it.
  return new Error(`pulling form submissions from ${new URL(destination.url).origin} stopped: ${message}. Rows not yet acknowledged stay at the host; pull again later.`, { cause: error });
}
