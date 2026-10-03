import path from "node:path";
import { SkillInputError, validateSkillFiles, type SkillUploadFile } from "./validation.js";
import { readSkillArchive } from "./archive.js";
import { fetchGitHubSkill, type GitHubSkillSource } from "./github.js";
import { readSkillState } from "./state.js";
import type { SkillInstallDeps } from "./ports.js";

export interface ManagedSkill { readonly toolId: string; readonly name: string; readonly description: string; readonly enabled: boolean; readonly source: "uploaded" | GitHubSkillSource }
export type SkillInstallInput = { readonly workspaceId: string } & ({ readonly githubUrl: string } | { readonly files: readonly SkillUploadFile[] } | { readonly archiveBase64: string });
export interface SkillInstaller {
  installSkill(required: SkillInstallInput): Promise<ManagedSkill>;
  listManagedSkills(required: { workspaceId: string }): Promise<ManagedSkill[]>;
  setSkillEnabled(required: { workspaceId: string; toolId: string; enabled: boolean }): Promise<void>;
  uninstallSkill(required: { workspaceId: string; toolId: string }): Promise<void>;
}

/** Validate before writes; publish via rename, with instance-local queues keyed by resolved root.
 * Cross-process exclusivity remains the host filesystem/layout adapter's responsibility.
 */
export function createSkillInstaller(deps: SkillInstallDeps, optional: { onChanged?: (required: { workspaceId: string; toolId: string }) => void | Promise<void> } = {}): SkillInstaller {
  const queues = new Map<string, Promise<unknown>>();
  const layoutFor = (workspaceId: string) => {
    const layout = deps.layout.resolve({ workspaceId });
    if (!path.isAbsolute(layout.workspaceRoot) || !path.isAbsolute(layout.stagingRoot)) throw new SkillInputError({ message: "Skill roots must be absolute." });
    if (!layout.stateFileName || /[/\\\x00]/.test(layout.stateFileName) || [".", ".."].includes(layout.stateFileName) || ["SKILL.md", "README.md", "LICENSE", "references", "scripts", "assets"].includes(layout.stateFileName)) throw new SkillInputError({ message: "Invalid skill state file name." });
    return layout;
  };
  async function locked<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    const key = layoutFor(workspaceId).workspaceRoot;
    const result = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    queues.set(key, result);
    try { return await result; }
    finally { if (queues.get(key) === result) queues.delete(key); }
  }
  async function listManagedSkills(required: { workspaceId: string }): Promise<ManagedSkill[]> {
    const layout = layoutFor(required.workspaceId);
    const sources = await deps.toolSourceLoader.load(required, { includeDisabled: true });
    return Promise.all(sources.map(async skill => {
      const directory = containedDirectory(layout.workspaceRoot, skill.directory);
      return { toolId: skill.id, name: skill.skillName, description: skill.description,
        ...await readSkillState({ directory, stateFileName: layout.stateFileName, filesystem: deps.filesystem }) };
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
  return {
    listManagedSkills,
    async installSkill(input) {
      let upload: readonly SkillUploadFile[];
      let source: ManagedSkill["source"] = "uploaded";
      if ("githubUrl" in input) ({ files: upload, source } = await fetchGitHubSkill({ githubUrl: input.githubUrl, fetch: deps.fetch }));
      else if ("archiveBase64" in input) upload = await readSkillArchive({ base64: input.archiveBase64, archiveReader: deps.archiveReader });
      else upload = input.files;
      const validated = validateSkillFiles({ files: upload, yamlReader: deps.yamlReader });
      const toolId = deps.toolId({ name: validated.name });
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
        const state = await readSkillState({ directory, stateFileName: layout.stateFileName, filesystem: deps.filesystem });
        const id = deps.ids.next({});
        if (!id || /[/\\\x00]/.test(id)) throw new SkillInputError({ message: "Invalid skill temporary id." });
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
}

function containedDirectory(root: string, directory: string): string {
  if (!directory || directory === "." || directory === ".." || /[/\\\x00]/.test(directory)) throw new SkillInputError({ message: "Skill directory must be one safe segment." });
  return path.join(root, directory);
}
