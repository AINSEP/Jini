import { formatUserFacingError, type UserFacingError } from "@jini-ai/core";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import type { StaticPublishPort } from "@jini-ai/core/contracts/site/deployment-admin";
import type { Translate } from "@jini-ai/core/text";
import { staticPublishFormReadyForPreview, staticPublishFormReadyToPublish, staticPublishProjectNameCopy, type StaticPublishProjectNameCopy, type AdminPublishTargetDescriptor } from "../rules.js";

import { useStaticPublishForm } from "./static-publish-form.hooks.js";
import { useStaticPublishRun, useStaticPublishPolling } from "./static-publish-run.hooks.js";
import { publish } from "./static-publish-actions.js";

type AdminStaticPublishTargetId = string;
export interface AdminStaticPublishConfig {
  target: AdminStaticPublishTargetId;
  fields: Readonly<Record<string, string>>;
}

/** Mirrors `StaticPublishOutcome` (same file) — the terminal result of one publish attempt, present
 *  on an {@link AdminPublishRunSnapshot} once `status` is `"completed"` or `"errored"`. */
type AdminStaticPublishOutcome =
  | { ok: true; targetId: AdminStaticPublishTargetId; url: string; status: string; deploymentId?: string; basePath?: string }
  | { ok: false; code: "INVALID_CONFIG" | "NO_CREDENTIALS_CONFIGURED" | "EXPORT_FAILED" | "PROVIDER_ERROR"; message: string };

/** Mirrors `PublishRunStatus` in the host's route. */
type AdminPublishRunStatus = "idle" | "running" | "completed" | "errored";

/** Mirrors `PublishRunSnapshot` (same file) — the trigger+poll run slot for a publish to a
 *  static host, independent of {@link AdminExportRunSnapshot}'s own run slot (a plain export and a
 *  publish are different server-side operations with their own process-local state). */
export interface AdminPublishRunSnapshot {
  status: AdminPublishRunStatus;
  startedAtIso: string | null;
  finishedAtIso: string | null;
  target: AdminStaticPublishTargetId | null;
  /** Present only once `status` is `"completed"` or `"errored"`. */
  result?: AdminStaticPublishOutcome;
  /** Present only on the rare path where the route itself failed unexpectedly — never echoes the
   *  raw error object. */
  error?: string;
}

/** Mirrors the JSON shape `GET .../system/publish/preview` returns — see that route's own doc
 *  comment in the server publish route. A pure read: never starts a run, never echoes a credential's value,
 *  only whether one is configured. */
export interface AdminStaticPublishPreview {
  target: AdminStaticPublishTargetId;
  valid: boolean;
  validationError: string | null;
  /** `/${repo}` for a host that serves under a repository subpath, `null` for a root-served host or an invalid config — always SERVER-derived,
   *  never something the caller supplied. */
  basePath: string | null;
  credentialsConfigured: boolean;
  credentialGuidance: string | null;
  willInjectNojekyll: boolean;
}


/**
 * @file Everything the Static Site tab's "Getting it online" provider form does — target selection,
 * the host's config fields and projectName, the preview action, and the publish
 * trigger+poll — so `StaticSiteTab.tsx` is only markup. Wired 2026-08-15 against
 * `the host publish-site.ts`'s three routes (preview, trigger, status).
 *
 * ## One form, fields from the host's descriptor
 *
 * The hosts, and each host's config fields, come from `GET .../system/publish-targets` (the deploy
 * plugin's descriptors) — this hook names no host. Config values are kept per target id, so
 * switching hosts never discards another host's half-filled fields, and `buildStaticPublishConfig`
 * (`rules.ts`) sends only the fields the selected host declares.
 *
 * ## `basePath` is never a field here
 *
 * There is no `setBasePath` anywhere in this file, on purpose — `AdminStaticPublishConfig` (the
 * wire type) has no such field either. The base path is always what `preview.basePath`/
 * `run.result.basePath` REPORT the server already computed, never something this form could send
 * back. See `static-publish/adapter.ts`'s `computeBasePath` for why that is structural, not a
 * missing feature.
 *
 * ## `preview` is invalidated by every field edit
 *
 * A stale preview computed against a DIFFERENT owner/repo would show the wrong base path next to a
 * form the operator has since changed — worse than showing nothing, since it looks current. Every
 * setter below clears `preview`/`previewError` as a side effect, so the "Preview" affordance always
 * either reflects the fields currently on screen or is honestly empty.
 */
export interface StaticPublishController {
  /** The deploy registry's targets, in its order — `undefined` until the first load resolves. */
  targets: readonly AdminPublishTargetDescriptor[] | undefined;
  /** Translated error from loading {@link targets}, `null` otherwise. */
  targetsError: string | null;
  /** The selected target's id — the operator's pick, else the first listed target; `""` while the
   *  list loads. */
  target: AdminStaticPublishTargetId;
  /** {@link target}'s descriptor, `undefined` while the list loads. */
  selectedTarget: AdminPublishTargetDescriptor | undefined;
  setTarget: (target: AdminStaticPublishTargetId) => void;
  /** The selected target's config values, keyed by descriptor field name. */
  configValues: Readonly<Record<string, string>>;
  setConfigField: (required: { name: string; value: string }, optional?: {}) => void;
  /** Whether Preview / Publish may be asked for with the current values (`rules.ts`). */
  canPreview: boolean;
  canPublish: boolean;
  /** The selected host's label and help for {@link projectName}; `null` when the host takes no
   *  project name, so the tab shows no such field. */
  projectNameCopy: StaticPublishProjectNameCopy | null;
  projectName: string;
  setProjectName: (value: string) => void;

  /** The most recent preview result — `undefined` until {@link checkPreview} has resolved at least
   *  once since the fields were last edited (see this file's header). */
  preview: AdminStaticPublishPreview | undefined;
  previewLoading: boolean;
  previewError: string | null;
  /** Runs a preview against the CURRENT field values for the CURRENT target. Resolves either way — a
   *  failure is surfaced through {@link previewError}. */
  checkPreview: () => Promise<void>;

  /** The current/most recent publish run — `undefined` until the first status read resolves. */
  run: AdminPublishRunSnapshot | undefined;
  /** True whenever `run.status === "running"` AND polling can still reach the status endpoint — see
   *  {@link pollError}'s own doc for why the second half matters (same shape
   *  `StaticExportController.isRunning` documents). */
  isPublishing: boolean;
  /** Already-formatted, translated error from the INITIAL status read — `null` while loading or once
   *  loaded successfully. Distinct from {@link publishError}: same split
   *  `StaticExportController.loadError`/`triggerError` draws. */
  loadError: string | null;
  /** Already-formatted, translated error from the poll loop giving up after a bounded number of
   *  consecutive failures — `null` while healthy, reset at the start of every new {@link publish}.
   *  Same shape and same reason `StaticExportController.pollError` exists: an unbounded retry here
   *  would strand the operator on a stuck "Publishing…" spinner with the button disabled forever. */
  pollError: string | null;
  publishError: string | null;
  publishFailure?: UserFacingError | null;
  /** True while a {@link publish} POST is in flight — briefer than {@link isPublishing}, which stays
   *  true for the whole publish, not just the initial request. Exposed (unlike an internal-only flag)
   *  so the caller can disable the Publish button on this alone, before any run comes back — without
   *  it, a double-click could send two POSTs before the first one's response ever arrives. */
  publishing: boolean;
  /** Starts a real publish with the current field values. Resolves either way — a failure is
   *  surfaced through {@link publishError}, never a thrown rejection. A call while {@link publishing}
   *  is already true is a duplicate submit and is ignored outright, not just discouraged by the
   *  disabled button — see this function's own implementation note.
   *
   *  `options.credentialId` names the saved connection the publish must use (terra review
   *  2026-09-20, finding 1). This hook never picks one itself: it has no credentials controller, and
   *  the caller (`StaticSiteTab`) is the one screen that knows which connection the operator is
   *  actually looking at. Omitted when this provider has no saved connection.
   *
   *  `options.destination` replays a saved destination (the Sites Export tab's Publish list) instead
   *  of this form's fields: the server already validated that target, project and config once. */
  publish: (options?: StaticPublishOptions) => Promise<void>;

  t: Translate;
}

/** What one {@link StaticPublishController.publish} call may name. */
export interface StaticPublishOptions {
  credentialId?: string;
  destination?: { config: AdminStaticPublishConfig; projectName: string };
}


export function useStaticPublish(required: {
  port: StaticPublishPort<AdminPublishTargetDescriptor, AdminStaticPublishConfig, AdminStaticPublishPreview, AdminPublishRunSnapshot>;
  t: Translate; locale: string;
  hooks: Pick<FetchQueryAdapter, "useFetchQuery">;
  deps: {
    localizePublishTargets: (required: { targets: AdminPublishTargetDescriptor[] | undefined; locale: string }) => AdminPublishTargetDescriptor[] | undefined;
    describeApiError: (required: { e: unknown; fallback: string }) => string;
    publishLoadErrorMessage: (required: { locale: string; error: string }) => string;
    publishPollErrorMessage: (required: { locale: string; error: string }) => string;
    publishPreviewErrorMessage: (required: { locale: string; error: string }) => string;
    publishTriggerErrorMessage: (required: { locale: string; error: string }) => string;
    errorRedactionOptions: Parameters<typeof formatUserFacingError>[1];
    setTimeout: typeof globalThis.setTimeout; clearTimeout: typeof globalThis.clearTimeout;
  };
}, _optional = {}): StaticPublishController {
  const form = useStaticPublishForm(required);
  const state = useStaticPublishRun(required);
  useStaticPublishPolling({ state, deps: required.deps });
  const { targets, targetsError, target, selectedTarget, setTarget, configValues, setConfigField, projectName, setProjectName, preview, previewLoading, previewError, checkPreview } = form;
  const { run, isPublishing, loadError, pollError, publishError, publishFailure, publishing } = state;
  const { t } = required;
  return {
    targets,
    targetsError,
    target,
    selectedTarget,
    setTarget,
    configValues,
    setConfigField,
    canPreview: staticPublishFormReadyForPreview({ target: selectedTarget, values: configValues }),
    canPublish: staticPublishFormReadyToPublish({ target: selectedTarget, values: configValues, projectName }),
    projectNameCopy: staticPublishProjectNameCopy({ target: selectedTarget }),
    projectName,
    setProjectName,
    preview,
    previewLoading,
    previewError,
    checkPreview,
    run,
    isPublishing,
    loadError,
    pollError,
    publishError,
    publishFailure,
    publishing,
    publish: (options = {}) => publish({ options, form, state, ...required }),
    t,
  };
}

export function bindStaticPublish({ hooks, deps }: {
  hooks: Parameters<typeof useStaticPublish>[0]["hooks"] & { useLocaleHook: () => string };
  deps: Parameters<typeof useStaticPublish>[0]["deps"] & Pick<Parameters<typeof useStaticPublish>[0], "port"> & {
    translate: (required: { locale: string; key: string }) => string;
  };
}, _optional = {}) {
  return function useBoundStaticPublish(_required: Record<string, never>, _optional = {}): StaticPublishController {
    const locale = hooks.useLocaleHook();
    const t = (key: string): string => deps.translate({ locale: locale, key: key });
    return useStaticPublish({ port: deps.port, t, locale, hooks, deps });
  };
}
