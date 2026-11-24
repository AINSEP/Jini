import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import { createNodeSkillFilesystem } from "../../install/index.js";
import { resolveSkillLayout, type SkillSiteHost } from "../layout.js";
import { loadInstalledSkillToolSources } from "../tool-registrations.js";
import { buildRegistrations, SKILLS_INSTALL_TOOL_ID } from "../install-tool.js";
import { commitSkillInstall, setSkillEnabled, uninstallSkill } from "../install-service.js";
import type { SkillInstaller } from "../../install/index.js";

/**
 * @file The host bindings `resolveSkillLayout` carries: the override variable, the site-root resolver,
 * the persisted state-file name the loader reads, and the permission check the install tool runs first.
 */

const WORKSPACE_ID = "workspace-local";
const MD = "---\nname: incident-response\ndescription: Respond to outages.\n---\nAlways check ownership.\n";

function fakeHost(overrides: Partial<SkillSiteHost> = {}, calls: unknown[] = []): SkillSiteHost {
  return {
    overrideEnvVar: "ACME_SKILLS_DIR",
    stateFileName: ".acme-install.json",
    processEnv: () => ({}),
    resolveSiteRoot: ({ cwd, env }) => path.join(cwd, "sites", env.ACME_SITE ?? "default"),
    filesystem: createNodeSkillFilesystem({}),
    archiveReader: { entries: async () => { throw new Error("unused"); } } as unknown as SkillSiteHost["archiveReader"],
    yamlReader: { read: () => ({}) },
    readFrontmatterField: ({ markdown, key }) => new RegExp(`^${key}: (.*)$`, "m").exec(markdown)?.[1],
    createFileReader: () => ({ read: async () => { throw new Error("unused"); } }),
    installers: new Map(),
    requireToolPermission: async (input, optional) => { calls.push({ input, optional }); },
    reportLifecycleEvent: () => {},
    reportSkippedFolder: () => {},
    ...overrides,
  };
}

test("defaults to <host site root>/skills and carries the host it was resolved with", () => {
  const host = fakeHost();
  const layout = resolveSkillLayout({ cwd: "/srv/site", env: { ACME_SITE: "second" }, host });
  assert.equal(layout.root, path.resolve("/srv/site/sites/second/skills"));
  assert.equal(layout.host, host);
  assert.equal(layout.forWorkspace({ workspaceId: "WORKSPACE-LOCAL" }).root, path.resolve("/srv/site/sites/second/skills/ws/workspace-local"));
});

test("a booted siteDir wins over the host resolver, and the host's override variable wins over both", () => {
  assert.equal(resolveSkillLayout({ siteDir: "/served/a", env: {}, host: fakeHost() }).root, path.resolve("/served/a/skills"));
  assert.equal(resolveSkillLayout({ siteDir: "/served/a", env: { ACME_SKILLS_DIR: "/explicit/skills" }, host: fakeHost() }).root, "/explicit/skills");
});

test("an absent env reads the host process environment, not the engine's", () => {
  const layout = resolveSkillLayout({ cwd: "/srv/site", host: fakeHost({ processEnv: () => ({ ACME_SKILLS_DIR: "/from/host" }) }) });
  assert.equal(layout.root, "/from/host");
});

test("a relative override is rejected with the host's variable name", () => {
  assert.throws(() => resolveSkillLayout({ cwd: "/srv/site", env: { ACME_SKILLS_DIR: "relative/path" }, host: fakeHost() }),
    { message: "ACME_SKILLS_DIR must be an absolute path, got 'relative/path'" });
});

test("forWorkspace rejects an id that could escape the path segment, quoting the raw input", () => {
  const layout = resolveSkillLayout({ cwd: "/srv/site", env: {}, host: fakeHost() });
  assert.throws(() => layout.forWorkspace({ workspaceId: "../escape" }), { message: "forWorkspace: '../escape' is not a valid workspace id" });
});

test("the loader reads enabled state from the host's state file name", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jini-site-skills-"));
  try {
    const layout = resolveSkillLayout({ env: { ACME_SKILLS_DIR: dir }, host: fakeHost() });
    const skillDir = path.join(layout.forWorkspace({ workspaceId: WORKSPACE_ID }).root, "incident-response");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), MD);
    const ctx = { workspaceId: WORKSPACE_ID, skillLayout: layout, siteBinding: { dir } };
    assert.deepEqual((await loadInstalledSkillToolSources(ctx)).map(source => source.skillName), ["incident-response"]);
    await writeFile(path.join(skillDir, ".acme-install.json"), JSON.stringify({ enabled: false, source: "uploaded" }));
    assert.deepEqual(await loadInstalledSkillToolSources(ctx), []);
    assert.deepEqual((await loadInstalledSkillToolSources({ ...ctx, includeDisabled: true })).map(source => source.skillName), ["incident-response"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("skills_install runs the host permission check before rejecting malformed input", async () => {
  const calls: unknown[] = [];
  const skillLayout = resolveSkillLayout({ cwd: "/srv/site", env: {}, host: fakeHost({}, calls) });
  const authorize = async () => true;
  const [registration] = buildRegistrations({ workspaceId: WORKSPACE_ID, skillLayout, siteBinding: { dir: "/srv/site" }, authorize } as never);
  assert.equal(registration!.descriptor.id, SKILLS_INSTALL_TOOL_ID);
  const ctx = { executionId: "e1", principal: { id: "principal-1" }, run: { id: "r1" }, input: { githubUrl: " " }, signal: new AbortController().signal };
  await assert.rejects(() => Promise.resolve(registration!.handler(ctx as never)), (error: unknown) => error instanceof ToolInputError
    && error.message === "githubUrl (an https://github.com/... URL) is the only, required argument.");
  assert.deepEqual(calls, [{ input: { authorize, workspaceId: WORKSPACE_ID, principalId: "principal-1", permission: "admin.assistant.use" }, optional: { entityType: "skill" } }]);
});

test("each completed lifecycle write goes to the host's reporter as a structured event, never the console", async () => {
  const events: unknown[] = [];
  const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const host = fakeHost({ reportLifecycleEvent: ({ event }) => { events.push(event); } });
    const skillLayout = resolveSkillLayout({ cwd: "/srv/site", env: {}, host });
    // A pre-seeded queue for this root: these tests cover the reports, not the installer.
    host.installers.set(skillLayout.root, {
      commitSkillInstall: async () => ({ toolId: "skill_notes" }),
      setSkillEnabled: async () => {},
      uninstallSkill: async () => {},
    } as unknown as SkillInstaller);
    const site = { skillLayout, siteBinding: { dir: "/srv/site" } };
    await commitSkillInstall({ ...site, workspaceId: WORKSPACE_ID, prepared: {} as never });
    await setSkillEnabled({ ...site, workspaceId: WORKSPACE_ID, toolId: "skill_notes", enabled: false });
    await uninstallSkill({ ...site, workspaceId: WORKSPACE_ID, toolId: "skill_notes" });
    assert.deepEqual(events, [
      { kind: "installed", workspaceId: WORKSPACE_ID, toolId: "skill_notes" },
      { kind: "enabled-changed", workspaceId: WORKSPACE_ID, toolId: "skill_notes", enabled: false },
      { kind: "removed", workspaceId: WORKSPACE_ID, toolId: "skill_notes" },
    ]);
    assert.equal(consoleInfo.mock.calls.length, 0);
  } finally { consoleInfo.mockRestore(); }
});

test("a skipped skill folder goes to the host's reporter naming the folder, never the console", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jini-site-skills-"));
  const messages: string[] = [];
  const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const layout = resolveSkillLayout({ env: { ACME_SKILLS_DIR: dir }, host: fakeHost({ reportSkippedFolder: ({ message }) => { messages.push(message); } }) });
    const skillDir = path.join(layout.forWorkspace({ workspaceId: WORKSPACE_ID }).root, "broken");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "no frontmatter\n");
    assert.deepEqual(await loadInstalledSkillToolSources({ workspaceId: WORKSPACE_ID, skillLayout: layout, siteBinding: { dir } }), []);
    assert.deepEqual(messages, ["[skills] 'broken': SKILL.md has no parseable frontmatter with both 'name' and 'description' — skipped"]);
    assert.equal(consoleWarn.mock.calls.length, 0);
  } finally { consoleWarn.mockRestore(); await rm(dir, { recursive: true, force: true }); }
});
