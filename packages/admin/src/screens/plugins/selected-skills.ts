/** Guidance stays host context until dispatch; transcript and title inputs stay user-authored. */
export interface SelectedComposerSkill {
  readonly toolId: string;
  readonly name: string;
  /** Verbatim loadSkillDraft result, including fs_read_file reference descriptors and Task suffix. */
  readonly guidance: string;
}

function isSelectedComposerSkill(skill: unknown): skill is SelectedComposerSkill {
  if (skill === null || typeof skill !== "object") return false;
  const fields = skill as { toolId?: unknown; name?: unknown; guidance?: unknown };
  return typeof fields.toolId === "string" && typeof fields.name === "string" && typeof fields.guidance === "string";
}

export function selectedSkillsFromContext({ context }: { context: Record<string, unknown> | undefined }, _optional = {}): readonly SelectedComposerSkill[] {
  const skills = context?.selectedSkills;
  if (!Array.isArray(skills)) return [];
  return skills.filter(isSelectedComposerSkill);
}

export function promptWithSelectedSkills({ prompt, context }: { prompt: string; context: Record<string, unknown> | undefined }, _optional = {}): string {
  const skills = selectedSkillsFromContext({ context });
  return skills.length === 0 ? prompt : `${skills.map(skill => skill.guidance).join("\n\n")}${prompt}`;
}

/** Plus selections keep the entire draft; slash selections remove only the active /query. */
export function draftAfterSkillSelection({ draft, source }: { draft: string; source: "plus" | "slash" }, _optional = {}): string {
  return source === "slash" ? draft.replace(/^\/[^\s/]*\s*/, "") : draft;
}
