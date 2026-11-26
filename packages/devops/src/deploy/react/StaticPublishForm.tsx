import { agentHandle } from "@jini-ai/core/agent-handles";
import type { Translate } from "@jini-ai/core/text";
import type { StaticPublishController } from "./hooks/use-static-publish.hooks.js";
import { fieldHelpText, publishConfigFieldHandleId, publishRunStatusLabelKey, runStatusTone } from "./rules.js";
import { PublishRunResult } from "./PublishRunResult.js";
import type { StaticSiteTabProps } from "./StaticSiteTab.js";
import { FieldLabel } from "./StaticCredentialFields.js";

function PublishFailureNotice({ controller, t: translate , kit }: { controller: StaticPublishController; t: Translate } & Pick<StaticSiteTabProps, "kit">, _optional = {}) {
  const { ErrorNotice } = kit;
  if (controller.publishFailure) return <ErrorNotice failure={controller.publishFailure} t={translate} className="save-error" />;
  return controller.publishError ? <p className="save-error" role="alert">{controller.publishError}</p> : null;
}

/**
 * {@link StaticPublishForm}'s per-target field block — the selected host's descriptor config fields
 * (a repository, a team), in the descriptor's order; nothing for a host that declares none. Input
 * ids come from `publishConfigFieldHandleId` (`rules.ts`), which keeps the ids agent tooling
 * already uses.
 */
function StaticPublishTargetFields({ controller, t: translate , deps }: { controller: StaticPublishController; t: Translate } & Pick<StaticSiteTabProps, "deps">, _optional = {}) {
  const { asciiSlug } = deps;
  // The target is bound once, up front: a field can only render when a target exists, so the
  // agent-handle label below reads `target.label` directly instead of a per-field
  // `selectedTarget?.label ?? ""` whose empty-label arm no field could ever reach.
  const target = controller.selectedTarget;
  if (!target) return null;
  return (
    <>
      {target.configFields.map((field) => {
        const id = publishConfigFieldHandleId({ asciiSlug, fieldName: field.name });
        return (
          <div className="field" key={field.name}>
            <FieldLabel field={field} htmlFor={id} t={translate} />
            <input
              id={id}
              type="text"
              value={controller.configValues[field.name] ?? ""}
              onChange={(e) => controller.setConfigField({ name: field.name, value: e.target.value })}
              {...agentHandle({ handle: id }, { role: "field", label: `${target.label} ${field.label}` })}
            />
            {fieldHelpText({ field }) ? <p className="field-hint">{fieldHelpText({ field })}</p> : null}
          </div>
        );
      })}
    </>
  );
}

/** The Preview action — its own component (not inlined in {@link StaticPublishForm}) purely for the
 *  complexity gate: every conditional in this file that renders on `controller.preview*` state used
 *  to accumulate directly in `StaticPublishForm`'s own cyclomatic count, which is what pushed that
 *  function over this repo's complexity convention once `pollError` (below) added one more branch on
 *  top of an already-over-budget function — splitting each `.deployment-action` block out the same
 *  way `PublishPreviewFacts`/`PublishRunResult` already are moves each block's branches into ITS OWN
 *  score instead. No behavior moved, only where the branches are counted. */
function PublishPreviewAction({
  canPreview,
  controller,
  t: translate,
}: {
  canPreview: boolean;
  controller: StaticPublishController;
  t: Translate;
}, _optional = {}) {
  return (
    <div className="deployment-action">
      <button
        type="button"
        className="btn-secondary"
        disabled={!canPreview || controller.previewLoading}
        onClick={() => void controller.checkPreview()}
        {...agentHandle({ handle: "deployment-static-site-publish-preview" }, { role: "button", label: "Preview what publishing to this target would do, without publishing anything" })}
      >
        {controller.previewLoading ? translate("Checking…") : translate("Preview")}
      </button>
      {controller.previewError ? (
        <p className="save-error" role="alert">
          {controller.previewError}
        </p>
      ) : null}
      {controller.preview ? <PublishPreviewFacts preview={controller.preview} t={translate} /> : null}
    </div>
  );
}

/** The Publish action — status pill, the button itself (gated by {@link busy}), and every terminal
 *  state a publish attempt can end in: a rejected trigger, a poll that gave up ({@link
 *  StaticPublishController.pollError} — see this file's header for why this pass added it here at
 *  all), and a settled run's own result. Split out of {@link StaticPublishForm} for the same
 *  complexity-gate reason {@link PublishPreviewAction} documents. `busy` and `runTone` are passed in
 *  rather than recomputed here — `busy` is `StaticPublishForm`'s own value, read by BOTH the disabled
 *  check below and the button's own label, and computing it twice would let the two drift; `runTone`
 *  is `runStatusTone({ status: controller.run?.status ?? "idle" }, ...)`, whose own optional-chaining/`??`
 *  operators each count as a branch for this repo's `complexity` rule same as a ternary does — kept
 *  in the parent (mirrors `BuildExportCard` keeping its own `tone` outside `ExportTriggerAction`)
 *  rather than pushing this function back over the 9/9 gate the same way computing it here once did. */
function PublishTriggerAction({
  canPublish,
  busy,
  credentialChangePending,
  chosenCredentialId,
  runTone,
  controller,
  t: translate,
 deps, kit }: {
  canPublish: boolean;
  busy: boolean;
  /** Disables Publish (without relabelling it "Publishing…") while a token switch or replacement is
   *  still in flight — the server would otherwise publish with the token being replaced. */
  credentialChangePending: boolean;
  /** {@link chosenCredentialIdForTarget}'s result — sent with the publish so the SERVER uses this
   *  exact connection rather than resolving its own default. */
  chosenCredentialId: string | undefined;
  runTone: string;
  controller: StaticPublishController;
  t: Translate;
} & Pick<StaticSiteTabProps, "deps" | "kit">, _optional = {}) {
  const { PUBLISH_RUN_RESULT_CLASSES } = deps;
  return (
    <div className="deployment-action">
      <span className={`status status-${runTone}`}>{translate(publishRunStatusLabelKey({ run: controller.run }))}</span>
      <button
        type="button"
        disabled={!canPublish || busy || credentialChangePending}
        onClick={() => void controller.publish(chosenCredentialId !== undefined ? { credentialId: chosenCredentialId } : {})}
        {...agentHandle({ handle: "deployment-static-site-publish-trigger" }, { role: "button", label: "Publish the current site export to this target right now — live on the public internet immediately" })}
      >
        {busy ? translate("Publishing…") : translate("Publish")}
      </button>
      <p className="deployment-action-reason">
        {translate("This is immediately live on the public internet once it finishes — there is no draft or review step.")}
      </p>
      <PublishFailureNotice kit={kit} controller={controller} t={translate} />
      <PublishPollNotice controller={controller} />
      {controller.run ? <PublishRunResult run={controller.run} publishedLabel={translate("Published:")} linkLabel="Open the just-published site" linkHandle="deployment-static-site-publish-result-url" classes={PUBLISH_RUN_RESULT_CLASSES} /> : null}
    </div>
  );
}

export function StaticPublishForm({
  controller,
  credentialChangePending,
  chosenCredentialId,
  t: translate,
 deps, kit }: {
  controller: StaticPublishController;
  /** {@link PublishCredentialsController.credentialChangePending} — see that field's doc. */
  credentialChangePending: boolean;
  /** {@link chosenCredentialIdForTarget}'s result for this target — see that function's own doc. */
  chosenCredentialId: string | undefined;
  t: Translate;
} & Pick<StaticSiteTabProps, "deps" | "kit">, _optional = {}) {
  const { canPreview, canPublish, projectNameCopy } = controller;
  const runTone = runStatusTone({ status: controller.run?.status ?? "idle" }, { ok: controller.run?.result?.ok });
  // `publishing` (the POST-in-flight flag) is included alongside `isPublishing` (the server-confirmed
  // "running" state) on purpose — without it, the window between clicking Publish and the response
  // supplying a "running" run left the button enabled, which is exactly how a double-click could send
  // two POSTs (see `use-static-publish.hooks.ts`'s own `publish()` for the matching in-hook guard —
  // this is the UI half of that same C4 fix, belt-and-suspenders rather than either alone).
  const busy = controller.isPublishing || controller.publishing;

  return (
    <div className="deployment-route">
      <StaticPublishHeading t={translate} />

      <div className="field-row field-row-top">
        <StaticPublishTargetFields deps={deps} controller={controller} t={translate} />
        <PublishProjectNameField projectNameCopy={projectNameCopy} controller={controller} t={translate} />
      </div>

      <PublishPreviewAction canPreview={canPreview} controller={controller} t={translate} />
      <PublishTriggerAction deps={deps} kit={kit}
        canPublish={canPublish}
        busy={busy}
        credentialChangePending={credentialChangePending}
        chosenCredentialId={chosenCredentialId}
        runTone={runTone}
        controller={controller}
        t={translate}
      />
    </div>
  );
}

/** A preview result's facts — base path (or "root, no prefix" for a root-served host/an invalid config) and
 *  whether a credential is configured. Never shows the credential itself — `preview.credentialsConfigured`
 *  is a boolean the server already reduced it to. */
function PublishPreviewFacts({ preview, t: translate }: { preview: NonNullable<StaticPublishController["preview"]>; t: Translate }, _optional = {}) {
  if (!preview.valid) {
    return (
      <p className="save-error" role="alert">
        {preview.validationError}
      </p>
    );
  }
  return (
    <div className="deployment-facts">
      <div className="deployment-fact">
        <span className="deployment-fact-label">{translate("Base path")}</span>
        <span className="deployment-fact-value">
          {preview.basePath ? <code translate="no">{preview.basePath}</code> : translate("None — serves from the domain root")}
        </span>
      </div>
      <div className="deployment-fact">
        <span className="deployment-fact-label">{translate("Credential")}</span>
        <span className={`status status-${preview.credentialsConfigured ? "ok" : "warning"}`}>
          {preview.credentialsConfigured ? translate("Configured") : translate("Not configured")}
        </span>
      </div>
      {!preview.credentialsConfigured && preview.credentialGuidance ? (
        <p className="deployment-action-reason">{preview.credentialGuidance}</p>
      ) : null}
    </div>
  );
}

function StaticPublishHeading({ t: translate }: { t: Translate }, _optional = {}) {
  return (
    <>
      <div className="deployment-route-label">
        {/* Step 2's plain numbered marker, not `DestinationIcon` (removed) — a bare "2" reads as
            the second half of the same sequence Step 1's own marker starts, which is exactly the
            "which have I done, what's next" legibility the numbered-step redesign exists for; a
            destination-pin icon paired with Step 1's number-or-checkmark badge would have been two
            different iconographic systems competing for the same job. Never gets a checkmark the
            way a connected credential's marker does — publishing is a repeatable action, not a
            one-time box to tick off. */}
        <span className="deployment-step-marker deployment-step-marker-inline" aria-hidden="true">
          2
        </span>
        <span className="deployment-fact-label">{translate("Where this publish goes")}</span>
      </div>
      <p className="deployment-action-reason">
        {translate(
          "The account above only proves you're allowed to publish — this says exactly where this one goes."
        )}
      </p>
    </>
  );
}

function PublishProjectNameField({ projectNameCopy, controller, t: translate }: { projectNameCopy: StaticPublishController["projectNameCopy"]; controller: StaticPublishController; t: Translate }, _optional = {}) {
  return (
    <>
        {projectNameCopy ? (
          <div className="field">
            <label className="field-label" htmlFor="deployment-static-site-publish-project-name">
              {translate(projectNameCopy.labelKey)}
            </label>
            <input
              id="deployment-static-site-publish-project-name"
              type="text"
              value={controller.projectName}
              onChange={(e) => controller.setProjectName(e.target.value)}
              {...agentHandle({ handle: "deployment-static-site-publish-project-name" }, {
                role: "field",
                label: `Human-facing label for this publish — ${projectNameCopy.helpKey ?? projectNameCopy.labelKey}`,
              })}
            />
            {projectNameCopy.helpKey ? (
              <p className="deployment-action-reason">{translate(projectNameCopy.helpKey)}</p>
            ) : null}
          </div>
        ) : null}
    </>
  );
}

function PublishPollNotice({ controller }: { controller: StaticPublishController }, _optional = {}) {
  return (
    <>
      {controller.pollError ? (
        <p
          className="notice warning"
          role="status"
          {...agentHandle({ handle: "deployment-static-site-publish-poll-error" }, {
            role: "status",
            label: "States that this publish's status could no longer be checked, so the button re-enabled even though the run may still be in progress",
          })}
        >
          {controller.pollError}
        </p>
      ) : null}
    </>
  );
}
