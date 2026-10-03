import type { Clock } from "@jini-ai/core/primitives";
/**
 * @file `collectPageEvidence()` — the bounded orchestration behind the `site_collect_page_evidence`
 * agent tool. Resolves the workspace's own verified origin, normalizes each requested path, drives
 * the browser port once per page, and returns observed evidence.
 *
 * ---------------------------------------------------------------------------
 * The one rule this module exists to enforce: evidence, never a verdict
 * ---------------------------------------------------------------------------
 * Nothing here scores, grades, passes, fails, or maps an observation to a regulation. There is no
 * `compliant` field and no place to put one. The tool reports what was seen and where it was seen;
 * deciding what that means is the `site-compliance` skill's job, under an output contract that
 * forbids it from stating a verdict either. Both halves have to hold — a tool that returned
 * `{ gdprCookieCheck: "pass" }` would make the skill's contract unenforceable, because the verdict
 * would already have been asserted upstream of it.
 *
 * Two consequences worth naming, because they look like missing features and are not:
 * - A page that could not be loaded produces a `skipped` entry with a reason, never an empty
 *   observation. "Nothing observed" and "observed nothing" are different facts and a report that
 *   confuses them is worse than no report.
 * - When the browser is unavailable, EVERY page is `skipped` with that reason and `pages` is empty.
 *   There is no configuration-derived fallback, because a fallback would be a guess wearing the
 *   evidence tool's credibility.
 *
 * ---------------------------------------------------------------------------
 * Bounds
 * ---------------------------------------------------------------------------
 * Every axis a hostile or careless caller could drive unbounded is capped by
 * {@link SITE_EVIDENCE_LIMITS}, and each cap is reported back in the result so a reader can tell a
 * truncated list from a complete one. Per skills/implementation-guardrails' resource-bounds rule:
 * maximum collection size (`maxPagesPerCall`), per-call timeout (`maxPageLoadMs`), overall deadline
 * (`maxTotalMs`), and explicit behaviour at the cap (excess pages are `skipped` with reason
 * `page-cap`, never silently dropped).
 *
 * ---------------------------------------------------------------------------
 * Nothing is persisted
 * ---------------------------------------------------------------------------
 * This module writes no file, no database row, and no cache. The browser adapter uses an ephemeral
 * context with no user-data directory. What the tool observed exists only in the value it returns,
 * and the shapes in `browser-port.ts` cannot represent a cookie value, a request body, or a form
 * field's contents in the first place.
 *
 * Architectural role:
 * Pure orchestration over two injected dependencies (an origin resolver and a browser factory).
 * No global state, no module-level singletons — `tool-registrations.ts` supplies both.
 */
import type { VerifiedOriginPort } from "./same-origin.js";
import { PageWorkBudget, PageWorkTimeout } from "./page-work-budget.js";

import type {
  ObservationPhase,
  PageObservation,
  SiteEvidenceBrowserFactory,
  SiteEvidenceBrowserPort,
} from "./browser-port.js";
import { isSameOriginUrl, normalizeSitePath, resolveSameOriginUrl, verifiedOriginToBaseUrl } from "./same-origin.js";

/**
 * Every bound this tool operates under, in one place so the values reported to the caller and the
 * values actually enforced cannot drift apart (they are the same constant).
 *
 * The numbers are deliberately small. This is an interactive tool an agent calls mid-conversation,
 * not a crawler: five pages is enough to screen a home page, a form page, and the policy pages,
 * and a caller who needs more can call again with the next five and say so in its report.
 */
export const SITE_EVIDENCE_LIMITS = {
  /** Hard cap on pages per call. Excess requested paths are returned as `skipped`. */
  maxPagesPerCall: 5,
  /** Per-page navigation + settle budget, including evaluation and cookie capture. */
  maxPageLoadMs: 15_000,
  /** Whole-call deadline. Once passed, remaining pages are `skipped` with `deadline`. */
  maxTotalMs: 60_000,
  /** Cap on the visible-text excerpt returned per page. */
  maxTextExcerptChars: 2_000,
  maxCookies: 100,
  maxRequests: 200,
  /** Cap per accessibility category (landmarks, headings, images, form controls). */
  maxAccessibilityNodesPerCategory: 200,
  maxContrastSamples: 40,
} as const;

/** Stated in every result. Not decoration: it is the tool half of the no-verdict contract, and it
 *  travels with the data into whatever context the model is reasoning in. */
export const SITE_EVIDENCE_DISCLAIMER =
  "Observed evidence only. This tool reports what was rendered, requested, and set when these pages " +
  "were loaded. It does not evaluate, score, or determine compliance with GDPR, CCPA/CPRA, WCAG, or " +
  "any other law or standard, and the absence of an observation is not evidence that something is " +
  "absent — it may mean it was not inspected.";

export type SkippedPageReason =
  | "invalid-path"
  | "page-cap"
  | "deadline"
  | "browser-unavailable"
  | "off-origin-redirect"
  | "navigation-failed";

export interface SkippedPage {
  readonly path: string;
  readonly reason: SkippedPageReason;
  readonly message: string;
}

export interface PageEvidence {
  /** The site-relative path as normalized — the citation key a report should quote. */
  readonly path: string;
  readonly url: string;
  readonly observation: PageObservation;
}

export type BrowserAvailabilityReport =
  | { readonly status: "available" }
  | { readonly status: "unavailable"; readonly reason: string };

export interface SiteEvidenceResult {
  readonly schemaVersion: "1";
  readonly collectedAt: string;
  /** The workspace's own verified origin — every URL below is on it, by construction. */
  readonly origin: string;
  readonly browser: BrowserAvailabilityReport;
  /** Whether a consent interaction was performed, and therefore whether `phase: "after"` evidence
   *  means anything on this run. */
  readonly consentTransition: ConsentTransitionReport;
  readonly limits: typeof SITE_EVIDENCE_LIMITS;
  readonly pages: readonly PageEvidence[];
  readonly skipped: readonly SkippedPage[];
  readonly disclaimer: string;
}

export type ConsentTransitionReport =
  | { readonly attempted: false; readonly reason: string }
  | { readonly attempted: true; readonly selector: string };

export interface CollectPageEvidenceDeps {
  readonly workspaceId: string;
  readonly originRegistry: VerifiedOriginPort;
  readonly openBrowser: SiteEvidenceBrowserFactory;
  readonly observationPolicy: ObservationPolicy;
}

/** Host policy runs before any browser-derived observation or failure message is returned. */
export interface ObservationPolicy {
 redactObservation(required: { observation: PageObservation }): PageObservation;
 redactMessage(required: { message: string }): string;
}

export interface CollectPageEvidenceOptions {
  // Inject time so the whole-call deadline can be checked without waiting for real time to pass.
  readonly clock?: Clock;
  /** CSS selector for the site's own consent-accept control. Without it no interaction happens and
   *  no `after`-phase evidence is produced — an omission the result states explicitly rather than
   *  leaving the caller to infer from an empty phase. */
  readonly consentAcceptSelector?: string;
  /** Defaults to true. Turning it off is a token-cost choice for a caller that only wants
   *  cookie/request evidence, not a way to make a page load cheaper. */
  readonly collectAccessibility?: boolean;
}

/**
 * Collects observed evidence for up to {@link SITE_EVIDENCE_LIMITS.maxPagesPerCall} pages of this
 * workspace's own published site.
 *
 * @param deps - Requested paths, verified-origin resolver, browser factory, and observation policy.
 * @param input - Optional clock, accessibility capture and consent selector.
 * @returns Observed evidence plus an explicit account of everything that was not observed and why.
 * @throws The origin port's error if the workspace has no verified
 * canonical origin. Deliberately propagated rather than converted into a per-page skip: with no
 * origin there is no same-origin boundary to enforce, and guessing one from a request host is
 * precisely what F2 forbids. The tool handler turns it into an actionable message.
 * @complexity O(p) page loads bounded by `maxPagesPerCall`, each bounded by `maxPageLoadMs`, the
 * whole call bounded by `maxTotalMs`. Space is bounded by the per-category caps above.
 * See docs/decisions/DR-001-trusted-evidence-addresses.md.
 */
export async function collectPageEvidence(
  deps: CollectPageEvidenceDeps & { readonly paths: readonly string[] },
  input: CollectPageEvidenceOptions = {},
): Promise<SiteEvidenceResult> {
  const clock = input.clock;
  const now = clock ? () => clock.nowMs() : Date.now;
  const startedAt = now();

  const origin = await deps.originRegistry.canonicalOrigin({ workspaceId: deps.workspaceId });
  const originBaseUrl = verifiedOriginToBaseUrl({ origin });

  const { accepted, skipped } = partitionRequestedPaths(deps.paths);

  const availability = await deps.openBrowser({});
  if (!availability.available) {
    const reason = deps.observationPolicy.redactMessage({ message: availability.reason });
    return {
      schemaVersion: "1",
      collectedAt: new Date(startedAt).toISOString(),
      origin: originBaseUrl,
      browser: { status: "unavailable", reason },
      consentTransition: consentTransitionReport(input.consentAcceptSelector),
      limits: SITE_EVIDENCE_LIMITS,
      pages: [],
      skipped: [
        ...skipped,
        ...accepted.map((path) => skip(path, "browser-unavailable", reason)),
      ],
      disclaimer: SITE_EVIDENCE_DISCLAIMER,
    };
  }

  const pages: PageEvidence[] = [];
  const runtimeSkipped: SkippedPage[] = [];

  try {
    for (const path of accepted) {
      const remainingMs = SITE_EVIDENCE_LIMITS.maxTotalMs - (now() - startedAt);
      if (remainingMs <= 0) {
        runtimeSkipped.push(
          skip(path, "deadline", `the ${SITE_EVIDENCE_LIMITS.maxTotalMs}ms whole-call budget was exhausted before this page was loaded`),
        );
        continue;
      }

      // A THROWING `observe()` (a port implementation that does not honor the `{ ok: false, reason }`
      // contract for every failure — e.g. the page navigating away between the load and the read
      // that follows it) must not end the whole run any more than an ordinary `ok: false` does. One
      // bad page is recorded as skipped; every OTHER requested page still gets its own attempt.
      try {
        // The port's timeout is advisory for custom adapters; bound our own await as well.
        const timeoutMs = Math.min(SITE_EVIDENCE_LIMITS.maxPageLoadMs, remainingMs);
        const outcome = await new PageWorkBudget({ timeoutMs }).run({
          work: () => observeOnePage(availability.browser, originBaseUrl, path, input, timeoutMs),
        });
        if (outcome.kind === "skipped") {
          runtimeSkipped.push({ ...outcome.skipped, message: deps.observationPolicy.redactMessage({ message: outcome.skipped.message }) });
        } else {
          pages.push({ ...outcome.page, observation: deps.observationPolicy.redactObservation({ observation: outcome.page.observation }) });
        }
      } catch (error) {
        const reason = error instanceof PageWorkTimeout && remainingMs <= SITE_EVIDENCE_LIMITS.maxPageLoadMs ? "deadline" : "navigation-failed";
        runtimeSkipped.push(skip(path, reason, deps.observationPolicy.redactMessage({ message: messageOf(error) })));
      }
    }
  } finally {
    // Release is still attempted after expiry; cleanup cannot add an unbounded wait to the call.
    await new PageWorkBudget({ timeoutMs: Math.max(0, SITE_EVIDENCE_LIMITS.maxTotalMs - (now() - startedAt)) })
      .release({ close: () => availability.browser.close({}) });
  }

  return {
    schemaVersion: "1",
    collectedAt: new Date(startedAt).toISOString(),
    origin: originBaseUrl,
    browser: { status: "available" },
    consentTransition: consentTransitionReport(input.consentAcceptSelector),
    limits: SITE_EVIDENCE_LIMITS,
    pages,
    skipped: [...skipped, ...runtimeSkipped],
    disclaimer: SITE_EVIDENCE_DISCLAIMER,
  };
}

type ObserveOnePageOutcome =
  | { readonly kind: "skipped"; readonly skipped: SkippedPage }
  | { readonly kind: "observed"; readonly page: PageEvidence };

/**
 * Resolves, loads, and validates exactly one requested page. Split out of
 * {@link collectPageEvidence} purely to keep that function's own cognitive complexity below the
 * repo's gate — the request shape, the failure handling, and the second same-origin check
 * (`same-origin.ts`'s header, layer 2) are unchanged.
 *
 * @complexity O(1) plus one browser page load.
 */
async function observeOnePage(
  browser: SiteEvidenceBrowserPort,
  originBaseUrl: string,
  path: string,
  input: CollectPageEvidenceOptions,
  timeoutMs: number,
): Promise<ObserveOnePageOutcome> {
  const url = resolveSameOriginUrl({ baseUrl: originBaseUrl, path });
  const result = await browser.observe({
    url,
    originBaseUrl,
    collectAccessibility: input.collectAccessibility ?? true,
    timeoutMs,
    maxTextExcerptChars: SITE_EVIDENCE_LIMITS.maxTextExcerptChars,
    maxCookies: SITE_EVIDENCE_LIMITS.maxCookies,
    maxRequests: SITE_EVIDENCE_LIMITS.maxRequests,
    maxAccessibilityNodesPerCategory: SITE_EVIDENCE_LIMITS.maxAccessibilityNodesPerCategory,
    maxContrastSamples: SITE_EVIDENCE_LIMITS.maxContrastSamples,
  }, input.consentAcceptSelector === undefined ? {} : { consentAcceptSelector: input.consentAcceptSelector });

  if (!result.ok) {
    return { kind: "skipped", skipped: skip(path, "navigation-failed", result.reason) };
  }

  // Second same-origin layer (`same-origin.ts`'s header, layer 2): the path could not name
  // another origin, but the SERVER can redirect to one. A page that left the origin is reported
  // as evidence of the redirect and its content is discarded — this tool does not inspect
  // anybody else's site, including one the inspected origin chose to point at.
  const finalUrl = result.observation.document.finalUrl;
  if (!isSameOriginUrl({ baseUrl: originBaseUrl, candidateUrl: finalUrl })) {
    return {
      kind: "skipped",
      skipped: skip(
        path,
        "off-origin-redirect",
        `redirected off the inspected origin to '${redactToOrigin(finalUrl)}' — not inspected; this tool only observes ${originBaseUrl}`,
      ),
    };
  }

  return { kind: "observed", page: { path, url, observation: result.observation } };
}

/**
 * Splits the requested paths into the ones this call will attempt and the ones it will not,
 * applying the syntactic guard first and the page cap second.
 *
 * Order matters and is not arbitrary: validating before capping means five valid paths followed by
 * an absolute URL still reports the absolute URL as `invalid-path` rather than hiding it behind
 * `page-cap`, so a caller that is doing something the tool refuses always learns that it was
 * refused rather than that it was merely truncated.
 *
 * @complexity O(n) in the requested-path count.
 */
function partitionRequestedPaths(paths: readonly string[]): {
  readonly accepted: readonly string[];
  readonly skipped: readonly SkippedPage[];
} {
  const accepted: string[] = [];
  const skipped: SkippedPage[] = [];

  for (const raw of paths) {
    const normalized = normalizeSitePath({ raw });
    if (!normalized.ok) {
      skipped.push(skip(raw, "invalid-path", `${normalized.message} (${normalized.reason})`));
      continue;
    }
    if (accepted.length >= SITE_EVIDENCE_LIMITS.maxPagesPerCall) {
      skipped.push(
        skip(
          normalized.path,
          "page-cap",
          `this call already accepted the maximum of ${SITE_EVIDENCE_LIMITS.maxPagesPerCall} pages — request the remaining paths in a follow-up call`,
        ),
      );
      continue;
    }
    accepted.push(normalized.path);
  }

  return { accepted, skipped };
}

function consentTransitionReport(selector: string | undefined): ConsentTransitionReport {
  if (selector === undefined) {
    return {
      attempted: false,
      reason:
        "no consentAcceptSelector was supplied, so no consent interaction was performed. Every cookie and " +
        "request below was observed in the pre-consent phase; nothing here shows what changes after a visitor accepts.",
    };
  }
  return { attempted: true, selector };
}

/** Reduces an off-origin URL to its origin before it appears in a skip reason. The redirect target
 *  is the evidence; its path and query are somebody else's data and may carry identifiers this tool
 *  has no business echoing back into a model's context. */
function redactToOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "(unparseable URL)";
  }
}

function skip(path: string, reason: SkippedPageReason, message: string): SkippedPage {
  return { path, reason, message };
}

/** Same tiny helper as `playwright-browser.ts`'s own — duplicated rather than imported, matching
 *  this feature's existing convention for a helper this small. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Re-exported so a caller building a report has the phase vocabulary without importing the port
 *  module directly. */
export type { ObservationPhase };
