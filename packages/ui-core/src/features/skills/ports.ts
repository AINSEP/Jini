import type { SkillDetail, SkillFileEntry, SkillSummary } from './types.js';

/** What a create or update call sends — the parsed shape `SkillDraft` edits
 *  toward, not the raw draft itself (`triggers` is already split; see
 *  `parseTriggers`). */
export interface SkillWritePayload {
  name: string;
  description?: string | undefined;
  body: string;
  triggers: readonly string[];
}

/**
 * The host-specific registry transport this tab needs — genuinely
 * host-owned: the origin called its own daemon's skill-registry endpoints.
 * This feature ships only a fake in `dependencies.ts`; a real host supplies
 * its own implementation (same convention as `ExecutionPort`).
 *
 * Every method REJECTS on failure, including `createSkill`/`updateSkill`/
 * `deleteSkill` — unlike `ExecutionPort.testConnection`, a registry write
 * has no "reached but declined" outcome worth modelling as a value; it
 * either persisted or it didn't. Client-side validation (is the draft even
 * submittable) stays out of the port entirely — see `validateSkillDraft`.
 */
export interface SkillsPort {
  /** The list view's payload — summaries only, no body. Called on mount. */
  listSkills(): Promise<readonly SkillSummary[]>;

  /** A skill's body text, fetched lazily on first expand so the list payload
   *  stays small. */
  fetchSkillDetail(id: string): Promise<SkillDetail>;

  /** A skill's on-disk file tree, fetched lazily alongside its body. */
  fetchSkillFiles(id: string): Promise<readonly SkillFileEntry[]>;

  /** Imports a new user-authored skill. */
  createSkill(payload: SkillWritePayload): Promise<SkillDetail>;

  /**
   * Updates an existing skill. Editing a BUILT-IN skill (`isBuiltInSkill`)
   * writes a user-owned shadow copy rather than modifying it in place — same
   * "override" semantics as the origin — so a host implementation may
   * return a skill with a DIFFERENT `id` than the one requested; the tab
   * re-keys its cached body/files onto whatever `SkillDetail.id` comes back.
   */
  updateSkill(id: string, payload: SkillWritePayload): Promise<SkillDetail>;

  /** Removes a user-authored skill. Never called for a built-in one — see
   *  `isDeletableSkill`. */
  deleteSkill(id: string): Promise<void>;
}
