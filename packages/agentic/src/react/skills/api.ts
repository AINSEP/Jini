import type { SkillInstallPayload } from "@jini-ai/core/contracts/site/skill-install";
import type { InstalledSkill } from "@jini-ai/core/contracts/site/installed-skill";

export type SkillFiles = {
  readonly toolId: string;
  readonly files: readonly { readonly relativePath: string; readonly sizeBytes: number; readonly content: string | null; readonly omitted: "binary" | "too-large" | "symlink" | "unreadable" | null }[];
  readonly truncated: boolean;
  readonly limits: { readonly maxFiles: number; readonly maxEntries: number; readonly maxFileBytes: number; readonly maxTotalBytes: number };
};
export function createSkillsApi({ request: authenticatedAdminRequest, workspaceId, notifyChanged, formatDraft, invalidGuidanceError }: {
  request: <T>(required: { path: string; method: string; body?: unknown }) => Promise<T>;
  workspaceId: string;
  notifyChanged: () => void;
  formatDraft: (required: { skillName: string; guidance: string; bundledFiles: { kind: string; root: string; path: string }[] }) => string;
  invalidGuidanceError: () => Error;
}, _optional: Record<string, never> = {}) {
const base = `/workspaces/${workspaceId}/skills`;
async function request<T>(_required = {}, { suffix = "", method, body }: { suffix?: string; method?: string; body?: unknown } = {}): Promise<T> {
  return authenticatedAdminRequest<T>({ path: `${base}${suffix}`, method: method ?? "GET", body });
}
async function listSkills() { return (await request<{ skills: InstalledSkill[] }>()).skills; }
function listSkillFiles({ toolId }: { toolId: string }, _optional = {}): Promise<SkillFiles> { return request({}, { suffix: `/${encodeURIComponent(toolId)}/files` }); }
async function installSkill({ payload }: { payload: SkillInstallPayload }, _optional: Record<string, never> = {}) { await request({}, { method: "POST", body: { ...payload, confirmed: true } }); notifyChanged(); }
async function removeSkill({ toolId }: { toolId: string }, _optional = {}) { await request({}, { suffix: `/${encodeURIComponent(toolId)}`, method: "DELETE" }); notifyChanged(); }
async function enableSkill({ toolId, enabled }: { toolId: string; enabled: boolean }, _optional = {}) { await request({}, { suffix: `/${encodeURIComponent(toolId)}`, method: "PATCH", body: { enabled } }); notifyChanged(); }

/** Selection fetches current enabled guidance; sending this draft puts the instructions in the run. */
async function loadSkillDraft({ toolId }: { toolId: string }, _optional = {}): Promise<string> {
  const skill = await request<{ skillName: string; guidance: string; bundledFiles: { kind: string; root: string; path: string }[] }>({}, { suffix: `/${encodeURIComponent(toolId)}/guidance` });
  if (typeof skill.skillName !== "string" || typeof skill.guidance !== "string" || !Array.isArray(skill.bundledFiles)) throw invalidGuidanceError();
  return formatDraft(skill);
}

return { listSkills, listSkillFiles, installSkill, removeSkill, enableSkill, loadSkillDraft };
}
