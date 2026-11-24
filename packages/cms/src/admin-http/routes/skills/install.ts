import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizeSkills, rejectSkillInput, rejectSkillInputError, type SkillInputErrorTest, type SkillRoutePrincipal } from "./shared.js";

/** One uploaded skill file: a package-relative path and its base64 bytes. */
export interface SkillUploadFile { path: string; contentBase64: string }

/** What the installer receives: the served workspace plus exactly one source. */
export type SkillInstallRequest = { workspaceId: string } & ({ githubUrl: string } | { archiveBase64: string } | { files: SkillUploadFile[] });

/** The installed skill as the admin client lists it. */
export interface InstalledSkill { readonly toolId: string; readonly name: string; readonly description: string; readonly enabled: boolean; readonly source: unknown }

/**
 * Installs one skill. Injected: installation fetches/unpacks the package and writes the host's
 * skill layout. It throws the host's skill input error for an invalid package or source.
 */
export type SkillInstallFn = (required: SkillInstallRequest) => Promise<InstalledSkill>;

/** The deps this route reads. */
export interface SkillInstallRouteDeps {
  workspaceId: string;
  installSkill: SkillInstallFn;
  isSkillInputError: SkillInputErrorTest;
}

const SOURCE_KEYS = ["githubUrl", "files", "archiveBase64"];
const ALLOWED_KEYS = ["confirmed", ...SOURCE_KEYS];
const SOURCE_ERROR = "Choose exactly one source: GitHub URL, files, or ZIP.";

/** Every entry is exactly `{ path, contentBase64 }`, both strings. @complexity O(n) in the entries. */
function hasUploadedSkillFiles(fields: Record<string, unknown>, _optional: Record<string, never> = {}): fields is Record<string, unknown> & { files: SkillUploadFile[] } {
  return Array.isArray(fields.files) && fields.files.every((f: unknown) => {
    if (!f || typeof f !== "object") return false;
    const entry = f as Record<string, unknown>;
    return typeof entry.path === "string" && typeof entry.contentBase64 === "string"
      && Object.keys(entry).every((key) => ["path", "contentBase64"].includes(key));
  });
}

/** Validates the request shape (one object, confirmed, exactly one known source) and returns its fields. @complexity O(k) in the body keys. */
function validatedInstallFields({ body }: { body: unknown }, _optional: Record<string, never> = {}): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) rejectSkillInput({ message: SOURCE_ERROR });
  const fields = body as Record<string, unknown>;
  // Confirmation is checked before the source: an unconfirmed request is refused for that alone.
  if (fields.confirmed !== true) rejectSkillInput({ message: "Confirm the skill installation first." });
  // An `undefined` alternative counts as absent, so a client may send unused source keys as undefined.
  const sources = SOURCE_KEYS.filter((key) => fields[key] !== undefined);
  if (sources.length !== 1 || Object.keys(fields).some((key) => !ALLOWED_KEYS.includes(key))) rejectSkillInput({ message: SOURCE_ERROR });
  return fields;
}

/** The one installer input for the chosen source; a source of the wrong type is a field error. @complexity O(n) in the entries. */
function installationInput({ body, workspaceId }: { body: unknown; workspaceId: string }, _optional: Record<string, never> = {}): SkillInstallRequest {
  const fields = validatedInstallFields({ body });
  if (typeof fields.githubUrl === "string") return { workspaceId, githubUrl: fields.githubUrl };
  if (typeof fields.archiveBase64 === "string") return { workspaceId, archiveBase64: fields.archiveBase64 };
  if (hasUploadedSkillFiles(fields)) return { workspaceId, files: fields.files };
  return rejectSkillInput({ message: "Skill source has invalid fields." });
}

/**
 * POST install one skill — one validator/service owns every installation transport (GitHub URL,
 * uploaded files, ZIP). The body is validated after authorization, as the hand-written route did,
 * so `parse` only carries it through.
 */
export const skillInstallRoute = defineJsonRoute<{ body: unknown }, { skill: InstalledSkill }, SkillInstallRouteDeps, SkillRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/skills",
  parse: (raw) => ok({ value: { body: raw.body } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeSkills({ authorize });
    const request = installationInput({ body: input.body, workspaceId: deps.workspaceId });
    try {
      return ok({ value: { skill: await deps.installSkill(request) } });
    } catch (err) {
      return rejectSkillInputError({ err, isSkillInputError: deps.isSkillInputError });
    }
  },
}, { successStatus: 201 });
