import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createToolRegistry, ToolInputError, type ToolRegistration } from "@jini-ai/core";
import { createNodeSkillFilesystem } from "../../install/index.js";
import { resolveSkillLayout, type SkillLifecycleEvent, type SkillSiteHost } from "../layout.js";
import { buildRegistrations, contributeSkillsInstallTools, derivedRisk, SKILLS_INSTALL_TOOL_ID } from "../install-tool.js";
import { installSkill, listManagedSkills, setSkillEnabled } from "../install-service.js";
import { buildSkillToolRegistrations, loadInstalledSkillToolSources, registerInstalledSkillTools } from "../tool-registrations.js";

/**
 * @file The site skill host end to end: a real installer over a temp directory, GitHub served by an
 * injected fetch, and the installed skill registered as its own tool.
 */

const WORKSPACE_ID = "workspace-local";
const COMMIT = "a".repeat(40);
const BLOB = "b".repeat(40);
const GITHUB_URL = "https://github.com/acme/skills";
const md = (name: string) => `---\nname: ${name}\ndescription: Respond to outages.\n---\nAlways check ownership.\n`;

const made: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true }); });

/** api.github.com for one repo holding one SKILL.md, recording every URL it was asked for. */
function githubFetch(markdown: string, urls: string[] = []): typeof fetch {
  return async (url) => {
    const address = String(url);
    urls.push(address);
    if (address.endsWith("/commits/HEAD")) return Response.json({ sha: COMMIT });
    if (address.endsWith(`/git/trees/${COMMIT}?recursive=1`)) {
      return Response.json({ truncated: false, tree: [{ path: "SKILL.md", type: "blob", mode: "100644", sha: BLOB, size: Buffer.byteLength(markdown) }] });
    }
    if (address.endsWith(`/git/blobs/${BLOB}`)) return Response.json({ encoding: "base64", content: Buffer.from(markdown).toString("base64") });
    throw new Error(`Unexpected request: ${address}`);
  };
}

async function siteFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "jini-site-install-"));
  made.push(dir);
  const events: SkillLifecycleEvent[] = [];
  const permissionChecks: unknown[] = [];
  const host: SkillSiteHost = {
    overrideEnvVar: "ACME_SKILLS_DIR",
    legacyStateFileNames: [],
    processEnv: () => ({}),
    resolveSiteRoot: ({ cwd }) => cwd,
    filesystem: createNodeSkillFilesystem({}),
    archiveReader: { open: async () => { throw new Error("archives are not used by GitHub installs"); } },
    yamlReader: { read: ({ yaml }) => ({ name: /^name: (.*)$/m.exec(yaml)?.[1], description: /^description: (.*)$/m.exec(yaml)?.[1] }) },
    readFrontmatterField: ({ markdown, key }) => new RegExp(`^${key}: (.*)$`, "m").exec(markdown)?.[1],
    createFileReader: () => ({ read: async () => ({ text: "reader text", files: ["references/guide.md"] }) }),
    installers: new Map(),
    requireToolPermission: async (input) => { permissionChecks.push(input); },
    reportLifecycleEvent: ({ event }) => { events.push(event); },
    reportSkippedFolder: () => {},
  };
  const skillLayout = resolveSkillLayout({ env: { ACME_SKILLS_DIR: path.join(dir, "skills") }, host });
  return { dir, host, events, permissionChecks, skillLayout, siteBinding: { dir } };
}

function execution(input: unknown, signal = new AbortController().signal) {
  return { executionId: "e1", principal: { id: "principal-1" }, run: { id: "r1" }, input, signal };
}

function installTool(site: Awaited<ReturnType<typeof siteFixture>>, skillFetch?: typeof fetch): ToolRegistration {
  const [registration] = buildRegistrations({ workspaceId: WORKSPACE_ID, skillLayout: site.skillLayout, siteBinding: site.siteBinding,
    authorize: async () => ({ allowed: true, reason: "test" }), ...(skillFetch ? { skillFetch } : {}) });
  return registration!;
}

describe("skills_install over the site host", () => {
  it("installs a GitHub skill pinned to one commit, writes it under the workspace, reports it, then refuses a second install", async () => {
    const site = await siteFixture();
    const urls: string[] = [];
    const tool = installTool(site, githubFetch(md("incident-response"), urls));
    const result = await tool.handler(execution({ githubUrl: `  ${GITHUB_URL}  ` }));
    expect(result).toMatchObject({
      installed: true,
      skill: { toolId: "skill_incident_response", name: "incident-response", enabled: true, source: { githubUrl: GITHUB_URL, commit: COMMIT } },
      note: "Installed the incident-response skill; it is on. Its tool skill_incident_response is picked up by the next search_tools call.",
    });
    expect(urls).toEqual([
      "https://api.github.com/repos/acme/skills/commits/HEAD",
      `https://api.github.com/repos/acme/skills/git/trees/${COMMIT}?recursive=1`,
      `https://api.github.com/repos/acme/skills/git/blobs/${BLOB}`,
    ]);
    const written = path.join(site.skillLayout.forWorkspace({ workspaceId: WORKSPACE_ID }).root, "incident-response", "SKILL.md");
    expect(await readFile(written, "utf8")).toBe(md("incident-response"));
    expect(site.events).toEqual([{ kind: "installed", workspaceId: WORKSPACE_ID, toolId: "skill_incident_response" }]);
    // One installer per resolved root, created on first use and reused afterwards.
    const installer = site.host.installers.get(site.skillLayout.root);
    expect(installer).not.toBeUndefined();

    await expect(tool.handler(execution({ githubUrl: GITHUB_URL }))).rejects.toThrow(new ToolInputError({
      message: "Skill 'incident-response' is already installed. Remove it from the Skills screen before installing another version.",
    }));
    expect(site.host.installers.get(site.skillLayout.root)).toBe(installer);
    expect(site.events).toHaveLength(1);
    expect(site.permissionChecks).toEqual([
      { authorize: expect.any(Function), workspaceId: WORKSPACE_ID, principalId: "principal-1", permission: "admin.assistant.use" },
      { authorize: expect.any(Function), workspaceId: WORKSPACE_ID, principalId: "principal-1", permission: "admin.assistant.use" },
    ]);
  });

  it("relays a service refusal as tool input, before any request, and propagates any other failure unchanged", async () => {
    const site = await siteFixture();
    const urls: string[] = [];
    await expect(installTool(site, githubFetch(md("x"), urls)).handler(execution({ githubUrl: "https://gitlab.com/acme/skills" })))
      .rejects.toThrow(new ToolInputError({ message: "Use an HTTPS GitHub repository URL, optionally ending in /tree/ref/skill-folder." }));
    expect(urls).toEqual([]);
    const outage = new Error("api.github.com unreachable");
    const failing = installTool(site, async () => { throw outage; }).handler(execution({ githubUrl: GITHUB_URL }));
    await expect(failing).rejects.toBe(outage);
    expect(site.events).toEqual([]);
  });

  it("rejects extra arguments, and stops before writing when the run is aborted after validation", async () => {
    const site = await siteFixture();
    const tool = installTool(site, githubFetch(md("incident-response")));
    await expect(tool.handler(execution({ githubUrl: GITHUB_URL, ref: "main" })))
      .rejects.toThrow(new ToolInputError({ message: "githubUrl (an https://github.com/... URL) is the only, required argument." }));
    const controller = new AbortController();
    controller.abort(new Error("run cancelled"));
    await expect(tool.handler(execution({ githubUrl: GITHUB_URL }, controller.signal))).rejects.toThrow("run cancelled");
    expect(await listManagedSkills({ skillLayout: site.skillLayout, siteBinding: site.siteBinding, workspaceId: WORKSPACE_ID })).toEqual([]);
    expect(site.events).toEqual([]);
  });

  it("fetches GitHub through the global fetch when the host injects no skillFetch", async () => {
    const site = await siteFixture();
    const urls: string[] = [];
    vi.stubGlobal("fetch", githubFetch(md("incident-response"), urls));
    await expect(installTool(site).handler(execution({ githubUrl: GITHUB_URL }))).resolves.toMatchObject({ installed: true, skill: { toolId: "skill_incident_response" } });
    expect(urls).toEqual([
      "https://api.github.com/repos/acme/skills/commits/HEAD",
      `https://api.github.com/repos/acme/skills/git/trees/${COMMIT}?recursive=1`,
      `https://api.github.com/repos/acme/skills/git/blobs/${BLOB}`,
    ]);
  });

  it("contributes skills_install as its own domain with its mutating risk", () => {
    const contributor = contributeSkillsInstallTools();
    expect(contributor.domain).toBe("skills-install");
    expect(contributor.build).toBe(buildRegistrations);
    expect(contributor.risk).toBe(derivedRisk);
    expect(derivedRisk.get(SKILLS_INSTALL_TOOL_ID)).toBe("mutates-durable-state");
  });
});

describe("installSkill and the installed-skill registry", () => {
  it("installSkill prepares and commits in one call, and listManagedSkills then names it", async () => {
    const site = await siteFixture();
    const skill = await installSkill({ workspaceId: WORKSPACE_ID, githubUrl: GITHUB_URL, skillLayout: site.skillLayout, siteBinding: site.siteBinding },
      { fetchImpl: githubFetch(md("notes")) });
    expect(skill).toMatchObject({ toolId: "skill_notes", name: "notes", enabled: true });
    expect((await listManagedSkills({ ...site, workspaceId: WORKSPACE_ID })).map(managed => managed.toolId)).toEqual(["skill_notes"]);
  });

  it("turning an installed skill off persists through the real installer, leaves no temporary state file and is reported", async () => {
    const site = await siteFixture();
    await installSkill({ workspaceId: WORKSPACE_ID, githubUrl: GITHUB_URL, skillLayout: site.skillLayout, siteBinding: site.siteBinding },
      { fetchImpl: githubFetch(md("notes")) });
    await setSkillEnabled({ ...site, workspaceId: WORKSPACE_ID, toolId: "skill_notes", enabled: false });
    expect((await listManagedSkills({ ...site, workspaceId: WORKSPACE_ID })).map(skill => [skill.toolId, skill.enabled])).toEqual([["skill_notes", false]]);
    expect(await loadInstalledSkillToolSources({ ...site, workspaceId: WORKSPACE_ID })).toEqual([]);
    const skillDir = path.join(site.skillLayout.forWorkspace({ workspaceId: WORKSPACE_ID }).root, "notes");
    expect((await readdir(skillDir)).filter(name => name.endsWith(".tmp"))).toEqual([]);
    expect(site.events).toEqual([
      { kind: "installed", workspaceId: WORKSPACE_ID, toolId: "skill_notes" },
      { kind: "enabled-changed", workspaceId: WORKSPACE_ID, toolId: "skill_notes", enabled: false },
    ]);
  });

  it("registers each installed skill directly on a registry that cannot list", async () => {
    const site = await siteFixture();
    const skillDir = path.join(site.skillLayout.forWorkspace({ workspaceId: WORKSPACE_ID }).root, "notes");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), md("notes"));
    const registered: ToolRegistration[] = [];
    const policyCalls: string[] = [];
    await registerInstalledSkillTools({ registry: { register: (tool) => { registered.push(tool); } }, ctx: {
      workspaceId: WORKSPACE_ID, skillLayout: site.skillLayout, siteBinding: site.siteBinding,
      withExtensionApprovalPolicy: ({ registration }) => { policyCalls.push(registration.descriptor.id); return registration; },
    } });
    expect(registered.map(tool => tool.descriptor.id)).toEqual(["skill_notes"]);
    expect(policyCalls).toEqual(["skill_notes"]);
  });

  it("a listing registry gets a single-flight refresh that picks up skills installed later", async () => {
    const site = await siteFixture();
    const registry = createToolRegistry({});
    const ctx = { workspaceId: WORKSPACE_ID, skillLayout: site.skillLayout, siteBinding: site.siteBinding,
      withExtensionApprovalPolicy: ({ registration }: { registration: ToolRegistration }) => registration };
    const liveRegistry = registry as typeof registry & { refreshInstalledSkills?: () => Promise<boolean> };
    await registerInstalledSkillTools({ registry: liveRegistry, ctx });
    expect(registry.has({ toolId: "skill_notes" })).toBe(false);
    const refresh = liveRegistry.refreshInstalledSkills;
    expect(typeof refresh).toBe("function");

    const skillDir = path.join(site.skillLayout.forWorkspace({ workspaceId: WORKSPACE_ID }).root, "notes");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), md("notes"));
    const first = liveRegistry.refreshInstalledSkills!();
    expect(liveRegistry.refreshInstalledSkills!()).toBe(first);
    await first;
    expect(registry.has({ toolId: "skill_notes" })).toBe(true);
    // A second registration of the same registry keeps the one refresh operation it installed.
    await registerInstalledSkillTools({ registry: liveRegistry, ctx });
    expect(liveRegistry.refreshInstalledSkills).toBe(refresh);
    expect(registry.list({}).map(tool => tool.id)).toContain("skill_notes");
  });

  it("buildSkillToolRegistrations serves each source's guidance with bundled files rooted at the site", async () => {
    const site = await siteFixture();
    const skillDir = path.join(site.skillLayout.forWorkspace({ workspaceId: WORKSPACE_ID }).root, "notes");
    await mkdir(path.join(skillDir, "references"), { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), md("notes"));
    await writeFile(path.join(skillDir, "references", "guide.md"), "guide");
    const sources = await loadInstalledSkillToolSources({ workspaceId: WORKSPACE_ID, skillLayout: site.skillLayout, siteBinding: site.siteBinding });
    const [registration, ...rest] = buildSkillToolRegistrations({ sources, withExtensionApprovalPolicy: ({ registration: tool }) => tool });
    expect(rest).toEqual([]);
    expect(registration!.descriptor.id).toBe("skill_notes");
    expect(await registration!.handler(execution({}))).toEqual({
      skillName: "notes", guidance: "reader text", files: ["references/guide.md"],
      bundledFiles: [{ kind: "references", root: "site", path: "skills/ws/workspace-local/notes/references/guide.md" }],
    });
  });
});
