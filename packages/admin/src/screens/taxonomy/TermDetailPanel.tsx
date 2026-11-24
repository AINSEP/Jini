import type { AdminTaxonomyWithTerms, AdminTerm } from "./api/taxonomy-api.types.js";
import type { JSX } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import { otherMergeTargets } from "./rules.js";
import type { TaxonomyScreenHooks, TaxonomyScreenParts, Translate } from "./taxonomy-screen-parts.js";

/**
 * @file The Categories & Tags screen's term detail column (`Taxonomy.tsx` mounts it once a term is
 * selected): status/parent/version, the rename form and the three-step merge wizard.
 */

export interface MergeTermSectionProps {
  taxonomy: AdminTaxonomyWithTerms;
  term: AdminTerm;
  onMerged: () => void;
  /** Translator closure — see `Taxonomy()`'s own `t`. */
  t: Translate;
  useMergeTermSectionHook: TaxonomyScreenHooks["useMergeTermSectionHook"];
}

interface MergeIdleStepProps {
  otherTerms: AdminTerm[];
  intoTermId: string;
  setIntoTermId: (id: string) => void;
  busy: boolean;
  startPlan: () => void;
  t: Translate;
}

/** The "choose a target, Plan merge" step — extracted out of `MergeTermSection`, which was still
 *  13/13 after the file's first extraction pass (the three `step === "..."` branches' own content,
 *  including each step's `busy` label ternary, were still counted in its scope). Same
 *  "the step, not the wizard shell, was the actual size" split `Users.tsx`'s
 *  `UserRow` -> `UserManagePanel` already used. */
function MergeIdleStep({ otherTerms, intoTermId, setIntoTermId, busy, startPlan, t }: MergeIdleStepProps): JSX.Element {
  return (
    <span className="jini-editor-actions">
      <select
        aria-label={t("Merge into")}
        value={intoTermId}
        onChange={(e) => setIntoTermId(e.target.value)}
        {...agentHandle({ handle: "term-merge-target" }, {
          role: "field",
          label: "The term this one will be merged into — set with page.select_option, not click",
        })}
      >
        <option value="">{t("Choose a term…")}</option>
        {otherTerms.map((term) => (
          <option key={term.id} value={term.id}>
            {term.name}
          </option>
        ))}
      </select>
      {/* Secondary throughout this wizard's first two steps — planning/confirming a merge
          commits nothing yet ("nothing is merged yet" below), so neither reads as this
          screen's primary action. Only Execute (genuinely irreversible) escalates. */}
      <button
        type="button"
        className="jini-btn-secondary"
        onClick={startPlan}
        disabled={!intoTermId || busy}
        {...agentHandle({ handle: "term-merge-plan" }, {
          role: "button",
          label: "Plan the merge into the selected term — commits nothing yet",
        })}
      >
        {busy ? t("Planning…") : t("Plan merge")}
      </button>
    </span>
  );
}

interface MergePlannedStepProps {
  termName: string;
  overlappingContentCount: number;
  busy: boolean;
  doConfirm: () => void;
  t: Translate;
}

/** The "review the plan, Confirm merge" step — extracted out of `MergeTermSection`. */
function MergePlannedStep({ termName, overlappingContentCount, busy, doConfirm, t }: MergePlannedStepProps): JSX.Element {
  return (
    <div>
      <p>
        {t("This will move {count} overlapping content assignment(s) onto the target term and merge").replace(
          "{count}",
          String(overlappingContentCount),
        )}{" "}
        <strong>{termName}</strong> {t("away. Confirming issues a one-time execution token — nothing is merged yet.")}
      </p>
      <button
        type="button"
        className="jini-btn-secondary"
        onClick={doConfirm}
        disabled={busy}
        {...agentHandle({ handle: "term-merge-confirm" }, {
          role: "button",
          label: "Confirm the plan and issue a one-time execution token — still commits nothing",
        })}
      >
        {busy ? t("Confirming…") : t("Confirm merge")}
      </button>
    </div>
  );
}

interface MergeConfirmedStepProps {
  busy: boolean;
  doExecute: () => void;
  t: Translate;
}

/** The "confirmed, Execute merge" step — extracted out of `MergeTermSection`. */
function MergeConfirmedStep({ busy, doExecute, t }: MergeConfirmedStepProps): JSX.Element {
  return (
    <div>
      <p>{t("Confirmed. Executing merges the terms now — this cannot be undone.")}</p>
      {/* Genuinely irreversible, per the copy right above — `.btn-danger`, unlike Plan/Confirm. */}
      <button
        type="button"
        className="jini-btn-danger"
        onClick={doExecute}
        disabled={busy}
        {...agentHandle({ handle: "term-merge-execute" }, {
          role: "button",
          label: "Execute the merge now — this cannot be undone",
        })}
      >
        {busy ? t("Merging…") : t("Execute merge")}
      </button>
    </div>
  );
}

function MergeTermSection(props: MergeTermSectionProps): JSX.Element | null {
  const { taxonomy, term, onMerged, t } = props;
  const otherTerms = otherMergeTargets({ taxonomy, excludeTermId: term.id });
  const { intoTermId, setIntoTermId, step, busy, error, plan, confirmationToken, startPlan, doConfirm, doExecute } = props.useMergeTermSectionHook({
    term,
    onMerged,
  });

  if (otherTerms.length === 0) return null;

  return (
    <div className="jini-notice jini-taxonomy-merge-section">
      <h3>{t("Merge into another term")}</h3>
      {error ? <span className="jini-save-error">{error}</span> : null}

      {step === "idle" ? (
        <MergeIdleStep otherTerms={otherTerms} intoTermId={intoTermId} setIntoTermId={setIntoTermId} busy={busy} startPlan={startPlan} t={t} />
      ) : null}

      {step === "planned" && plan ? (
        <MergePlannedStep
          termName={term.name}
          overlappingContentCount={plan.overlappingContentCount}
          busy={busy}
          doConfirm={doConfirm}
          t={t}
        />
      ) : null}

      {step === "confirmed" && confirmationToken ? <MergeConfirmedStep busy={busy} doExecute={doExecute} t={t} /> : null}
    </div>
  );
}

export interface TermDetailPanelProps {
  taxonomy: AdminTaxonomyWithTerms;
  term: AdminTerm;
  onRenamed: () => void;
  onMerged: () => void;
  /** Translator closure — see `Taxonomy()`'s own `t`. */
  t: Translate;
  parts: TaxonomyScreenParts;
}

export function TermDetailPanel({ taxonomy, term, onRenamed, onMerged, t, parts }: TermDetailPanelProps): JSX.Element {
  const { newName, setNewName, saving, message, error, rename } = parts.useTermDetailPanelHook({ term, onRenamed });
  const { StatusLabel } = parts;

  return (
    <div className="jini-settings-detail-panel jini-taxonomy-term-detail">
      <h2>{term.name}</h2>
      <p className="jini-muted-cell">{taxonomy.taxonomy.name}</p>
      <div className="jini-settings-layer-grid">
        <div className="jini-settings-layer-cell">
          <span className="jini-settings-layer-label">{t("Status")}</span>
          <span className={`jini-status jini-status-${term.status}`}><StatusLabel value={term.status} /></span>
        </div>
        <div className="jini-settings-layer-cell">
          <span className="jini-settings-layer-label">{t("Parent")}</span>
          <span>
            {term.parentId ? taxonomy.terms.find((candidate) => candidate.id === term.parentId)?.name ?? term.parentId : "—"}
          </span>
        </div>
        <div className="jini-settings-layer-cell">
          <span className="jini-settings-layer-label">{t("Version")}</span>
          <span>{term.version}</span>
        </div>
      </div>
      <form onSubmit={rename} className="jini-collections-field-row">
        <label htmlFor="term-rename-input">{t("Rename")}</label>
        <input
          id="term-rename-input"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          {...agentHandle({ handle: "term-detail-rename" }, { role: "field", label: "This term's new name" })}
        />
        <span className="jini-editor-actions">
          <button
            type="submit"
            className="jini-btn-secondary"
            disabled={saving}
            {...agentHandle({ handle: "term-detail-rename-save" }, { role: "button", label: "Save this term's new name" })}
          >
            {saving ? t("Saving…") : t("Save")}
          </button>
          {message ? <span className="jini-save-ok">{message}</span> : null}
          {error ? <span className="jini-save-error">{error}</span> : null}
        </span>
      </form>
      <MergeTermSection taxonomy={taxonomy} term={term} onMerged={onMerged} t={t} useMergeTermSectionHook={parts.useMergeTermSectionHook} />
    </div>
  );
}

