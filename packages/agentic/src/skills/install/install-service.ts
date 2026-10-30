import path from "node:path";
import { SkillInputError, validateSkillFiles, type SkillUploadFile } from "./validation.js";
import { readSkillArchive } from "./archive.js";
import { fetchGitHubSkill, type GitHubSkillSource } from "./github.js";
import { readSkillState } from "./state.js";
import type { SkillInstallDeps } from "./ports.js";
import { hasSeparatorOrNul } from "./unsafe-chars.js";

export interface ManagedSkill<Source extends object = GitHubSkillSource> { readonly toolId: string; readonly name: string; readonly description: string; readonly enabled: boolean; readonly source: "uploaded" | GitHubSkillSource | Source }
export type SkillInstallInput = { readonly workspaceId: string } & (
  { readonly url: string } |
  { /** @deprecated Use url with an injected source provider. */ readonly githubUrl: string } |
  { readonly files: readonly SkillUploadFile[] } | { readonly archiveBase64: string }
);
/** A fetched and fully validated skill package, not yet written. Holding the validated bytes (not
 * the source) means commitSkillInstall writes exactly what was validated, with no second fetch. */
export interface PreparedSkillInstall<Source extends object = GitHubSkillSource> {
  readonly toolId: string; readonly name: string; readonly description: string; readonly source: ManagedSkill<Source>["source"];
  readonly files: ReturnType<typeof validateSkillFiles>["files"];
}
/** Fetch/decode and validate before asking for mutation approval. No filesystem writes. */
export async function prepareSkillInstall<Source extends object = GitHubSkillSource>(required: { input: SkillInstallInput; deps: Pick<SkillInstallDeps<Source>, "fetch" | "fetchSource" | "validateSource" | "archiveReader" | "yamlReader" | "toolId"> }, _optional = {}): Promise<PreparedSkillInstall<Source>> {
  const { input, deps } = required;
  let upload: readonly SkillUploadFile[];
  let source: ManagedSkill<Source>["source"] = "uploaded";
  if ("url" in input || "githubUrl" in input) ({ files: upload, source } = await fetchRemoteSkill({ input, deps }));
  else if ("archiveBase64" in input) upload = await readSkillArchive({ base64: input.archiveBase64, archiveReader: deps.archiveReader });
  else upload = input.files;
  const validated = validateSkillFiles({ files: upload, yamlReader: deps.yamlReader });
  return { ...validated, toolId: deps.toolId({ name: validated.name }), source };
}
/** Source selection only; installation validation and mutation stay in the existing lifecycle.
 * Normalized URLs never fall back to GitHub. An injected provider owns legacy aliases too.
 * @throws SkillInputError for missing provider configuration or refused provenance.
 */
async function fetchRemoteSkill<Source extends object>({ input, deps }: {
  input: { readonly url: string } | { readonly githubUrl: string };
  deps: Pick<SkillInstallDeps<Source>, "fetch" | "fetchSource" | "validateSource">;
}, _optional: Record<string, never> = {}): Promise<{ readonly files: readonly SkillUploadFile[]; readonly source: GitHubSkillSource | Source }> {
  if (deps.fetchSource) {
    if (!deps.validateSource) throw new SkillInputError({ message: "Skill source provenance validation is required." });
    const result = await deps.fetchSource({ url: "url" in input ? input.url : input.githubUrl }, {});
    if (!isSourceObject(result.source) || !deps.validateSource({ source: result.source }, {})) throw new SkillInputError({ message: "Invalid skill source provenance." });
    return result;
  }
  if ("url" in input) throw new SkillInputError({ message: "A skill source provider is required for URL installation." });
  if (!deps.fetch) throw new SkillInputError({ message: "A legacy GitHub fetch transport is required." });
  return fetchGitHubSkill({ githubUrl: input.githubUrl, fetch: deps.fetch });
}

function isSourceObject(source: unknown): boolean {
  return !!source && typeof source === "object" && !Array.isArray(source);
}

export interface SkillInstaller<Source extends object = GitHubSkillSource> {
  prepareSkillInstall(required: SkillInstallInput): Promise<PreparedSkillInstall<Source>>;
  commitSkillInstall(required: { workspaceId: string; prepared: PreparedSkillInstall<Source> }): Promise<ManagedSkill<Source>>;
  installSkill(required: SkillInstallInput): Promise<ManagedSkill<Source>>;
  listManagedSkills(required: { workspaceId: string }): Promise<ManagedSkill<Source>[]>;
  setSkillEnabled(required: { workspaceId: string; toolId: string; enabled: boolean }): Promise<void>;
  uninstallSkill(required: { workspaceId: string; toolId: string }): Promise<void>;
}

/** Validate before writes; publish via rename, with instance-local queues keyed by resolved root.
 * Cross-process exclusivity remains the host filesystem/layout adapter's responsibility.
 */
export function createSkillInstaller<Source extends object = GitHubSkillSource>(deps: SkillInstallDeps<Source>, optional: { onChanged?: (required: { workspaceId: string; toolId: string }) => void | Promise<void> } = {}): SkillInstaller<Source> {
  const queues = new Map<string, Promise<unknown>>();
  const layoutFor = (workspaceId: string) => {
    const layout = deps.layout.resolve({ workspaceId });
    if (!path.isAbsolute(layout.workspaceRoot) || !path.isAbsolute(layout.stagingRoot)) throw new SkillInputError({ message: "Skill roots must be absolute." });
    if (!layout.stateFileName || hasSeparatorOrNul(layout.stateFileName) || [".", ".."].includes(layout.stateFileName) || ["SKILL.md", "README.md", "LICENSE", "references", "scripts", "assets"].includes(layout.stateFileName)) throw new SkillInputError({ message: "Invalid skill state file name." });
    return layout;
  };
  /** Serializes mutations in this server without leaving persistent locks after a crash. */
  async function locked<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    const key = layoutFor(workspaceId).workspaceRoot;
    const result = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    queues.set(key, result);
    try { return await result; }
    finally { if (queues.get(key) === result) queues.delete(key); }
  }
  async function listManagedSkills(required: { workspaceId: string }): Promise<ManagedSkill<Source>[]> {
    const layout = layoutFor(required.workspaceId);
    const sources = await deps.toolSourceLoader.load(required, { includeDisabled: true });
    return Promise.all(sources.map(async skill => {
      const directory = containedDirectory(layout.workspaceRoot, skill.directory);
      return { toolId: skill.id, name: skill.skillName, description: skill.description,
        ...await readSkillState<Source>({ directory, stateFileName: layout.stateFileName, filesystem: deps.filesystem, validateSource: deps.validateSource }) };
    }));
  }
  async function managedDirectory(required: { workspaceId: string; toolId: string }): Promise<string> {
    const skill = (await deps.toolSourceLoader.load({ workspaceId: required.workspaceId }, { includeDisabled: true })).find(source => source.id === required.toolId);
    if (!skill) throw new SkillInputError({ message: "Skill was not found." });
    const directory = containedDirectory(layoutFor(required.workspaceId).workspaceRoot, skill.directory);
    if ((await deps.filesystem.lstat({ path: directory })).kind !== "directory") throw new SkillInputError({ message: "Skill directory must be a regular directory." });
    return directory;
  }
  const changed = async (workspaceId: string, toolId: string) => { await optional.onChanged?.({ workspaceId, toolId }); };
  const installer: SkillInstaller<Source> = {
    listManagedSkills,
    prepareSkillInstall: input => prepareSkillInstall({ input, deps }),
    async installSkill(input) {
      return installer.commitSkillInstall({ workspaceId: input.workspaceId, prepared: await prepareSkillInstall({ input, deps }) });
    },
    async commitSkillInstall(input) {
      const validated = input.prepared;
      const { toolId, source } = validated;
      const layout = layoutFor(input.workspaceId);
      return locked(input.workspaceId, async () => {
        if ((await listManagedSkills(input)).some(skill => skill.toolId === toolId)) throw new SkillInputError({ message: `Skill '${validated.name}' is already installed. Remove it before installing another version.` });
        await deps.filesystem.mkdir({ path: layout.workspaceRoot });
        await deps.filesystem.mkdir({ path: layout.stagingRoot });
        const staging = await deps.filesystem.mkdtemp({ prefix: path.join(layout.stagingRoot, "skill-") });
        try {
          for (const [relative, bytes] of validated.files) {
            const target = path.join(staging, relative);
            await deps.filesystem.mkdir({ path: path.dirname(target) });
            await deps.filesystem.writeFile({ path: target, bytes, exclusive: true, mode: 0o600 });
          }
          await deps.filesystem.writeFile({ path: path.join(staging, layout.stateFileName), bytes: Buffer.from(JSON.stringify({ enabled: true, source })), exclusive: true, mode: 0o600 });
          await deps.filesystem.rename({ from: staging, to: path.join(layout.workspaceRoot, validated.name) });
          await changed(input.workspaceId, toolId);
          return { toolId, name: validated.name, description: validated.description, enabled: true, source };
        } finally { await deps.filesystem.remove({ path: staging }, { recursive: true, force: true }); }
      });
    },
    async setSkillEnabled(input) {
      if (typeof input.enabled !== "boolean") throw new SkillInputError({ message: "enabled must be a boolean." });
      await locked(input.workspaceId, async () => {
        const directory = await managedDirectory(input);
        const layout = layoutFor(input.workspaceId);
        const state = await readSkillState<Source>({ directory, stateFileName: layout.stateFileName, filesystem: deps.filesystem, validateSource: deps.validateSource });
        const id = deps.ids.next({});
        if (!id || hasSeparatorOrNul(id)) throw new SkillInputError({ message: "Invalid skill temporary id." });
        const temporary = path.join(directory, `.skill-state-${id}.tmp`);
        try {
          // A rejected write can leave partial bytes; cleanup must cover writing as well as rename.
          await deps.filesystem.writeFile({ path: temporary, bytes: Buffer.from(JSON.stringify({ ...state, enabled: input.enabled })), exclusive: true, mode: 0o600 });
          await deps.filesystem.rename({ from: temporary, to: path.join(directory, layout.stateFileName) });
        }
        finally { await deps.filesystem.remove({ path: temporary }, { force: true }); }
        await changed(input.workspaceId, input.toolId);
      });
    },
    async uninstallSkill(input) {
      await locked(input.workspaceId, async () => {
        await deps.filesystem.remove({ path: await managedDirectory(input) }, { recursive: true });
        await changed(input.workspaceId, input.toolId);
      });
    },
  };
  return installer;
}

function containedDirectory(root: string, directory: string): string {
  if (!directory || directory === "." || directory === ".." || hasSeparatorOrNul(directory)) throw new SkillInputError({ message: "Skill directory must be one safe segment." });
  return path.join(root, directory);
}
