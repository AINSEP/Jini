import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "../legacy-test.js";

import { forceRemove } from "../fixtures/force-remove.js";
import { setAgentPluginActivation } from "../test-support.js";

import { resolveAgentPluginLayout } from "../test-support.js";

import { installAgentPlugin } from "../test-support.js";
import { type AgentPluginArchiveEntry, type AgentPluginArchiveReaderPort } from "../../install.js";
import { resolveAgentPluginDeliveryMode, resolveAgentPluginRefs } from "../test-support.js";


/**
 * @file `resolveAgentPluginRefs()` — the run-start resolution step `agent-daemon-server.ts`'s
 * `onStarted` calls to turn a pinned composer chip (`pluginRefIds`) into real prompt-prefix text.
 *
 * Every "installed package" fixture below goes through the REAL `installAgentPlugin()` pipeline
 * (extraction, containment, freeze) against a real temp `AgentPluginWorkspaceLayout` — the same
 * idiom `install.unit.test.ts` already establishes — rather than hand-writing files into a
 * directory. The SKILL.md content each test asserts against is read back independently via a bare
 * `readFile` on the installed path, not re-compared against the same string literal the test wrote
 * — this is what proves the resolver reads REAL bytes off REAL disk rather than merely echoing
 * whatever a mock happened to hand it.
 */

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

function reader(entries: readonly AgentPluginArchiveEntry[]): AgentPluginArchiveReaderPort {
  return {
    async *entries() {
      yield* entries;
    },
  };
}

function fileEntry(entryPath: string, content: string): AgentPluginArchiveEntry {
  const bytes = Buffer.from(content, "utf8");
  return {
    kind: "file",
    entryPath,
    declaredSize: bytes.byteLength,
    executable: false,
    async *openReadStream() {
      yield bytes;
    },
  };
}

/** A real, non-trivial SKILL.md body — long enough and specific enough that a test asserting the
 *  resolver's output contains it could not accidentally pass against a truncated or substituted
 *  read. */
const REAL_SKILL_MARKDOWN =
  "# UI/UX Design\n\n" +
  "Use an 8px spacing grid, WCAG AA contrast minimums, and prefer system fonts over web fonts " +
  "for body copy. Every interactive control needs a visible focus ring — never `outline: none` " +
  "without a replacement.\n";

function manifest(name: string, version = "1.1.0"): string {
  return JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name, version });
}

async function freshLayout() {
  const cwd = await realpath(await mkdtemp(path.join(tmpdir(), "host-resolve-agent-plugin-refs-test-")));
  const instanceLayout = resolveAgentPluginLayout({ cwd, env: {} });
  return { cwd, layout: instanceLayout.forWorkspace({ workspaceId: WORKSPACE_ID }) };
}

/** Installs one real package (via the production `installAgentPlugin` pipeline) with the given
 *  `pluginId` and skill markdown, keyed to a unique archive so a second call in the same test
 *  produces a genuinely different digest. `cwd` must be the SAME root {@link freshLayout} resolved
 *  its workspace layout from — `installAgentPlugin` re-resolves the instance-level layout from it
 *  independently, and a mismatched `cwd` would install into a different tree than the one the
 *  test's own `layout.pluginPackagesDir({ pluginId })` points at. */
async function installRealPackage(
  cwd: string,
  pluginId: string,
  skillMarkdown: string,
  archiveSeed: string,
) {
  const entries = [fileEntry("plugin.json", manifest(pluginId)), fileEntry(`skills/${pluginId}/SKILL.md`, skillMarkdown)];
  const archive = new Uint8Array(Buffer.from(archiveSeed));
  const digest = createHash("sha256").update(archive).digest("hex");
  return installAgentPlugin({
    archive,
    expectedSha256: digest,
    archiveReader: reader(entries),
    layout: resolveAgentPluginLayout({ cwd, env: {} }),
    workspaceId: WORKSPACE_ID,
  });
}

test("resolves to an empty promptPrefix and touches no filesystem when pluginRefIds is empty", async () => {
  // Both paths are deliberately nonexistent: the empty-refs fast path must return before it touches
  // EITHER `packages` (to list installs) or `root` (to read the activation record, added 2026-08-26).
  const result = await resolveAgentPluginRefs([], {
    packages: "/does-not-exist-and-is-never-read",
    root: "/does-not-exist-and-is-never-read-either",
  });
  assert.deepEqual(result, { ok: true, promptPrefix: "" });
});

test("resolves a real, genuinely installed plugin's SKILL.md content verbatim into the prefix", async () => {
  const { cwd, layout } = await freshLayout();
  try {
    await installRealPackage(cwd, "ui-ux-design", REAL_SKILL_MARKDOWN, "archive-real-1");

    const result = await resolveAgentPluginRefs(["ui-ux-design"], layout);

    assert.equal(result.ok, true);
    assert.ok(result.ok);
    // Independent read of the installed file — proves the resolver's output is the REAL bytes on
    // disk, not a value that merely happens to match what this test itself wrote above.
    const [digest] = await readdir(layout.pluginPackagesDir({ pluginId: "ui-ux-design" }));
    const independentRead = await readFile(path.join(layout.pluginPackagesDir({ pluginId: "ui-ux-design" }), digest as string, "skills/ui-ux-design/SKILL.md"), "utf8");
    assert.equal(independentRead, REAL_SKILL_MARKDOWN);
    assert.ok(result.promptPrefix.includes(independentRead));
  } finally {
    await forceRemove(cwd);
  }
});

test("does not include the SKILL.md content when pluginRefIds is absent (regression: insertText used to type an inert string instead)", async () => {
  const { cwd, layout } = await freshLayout();
  try {
    await installRealPackage(cwd, "ui-ux-design", REAL_SKILL_MARKDOWN, "archive-real-2");

    const result = await resolveAgentPluginRefs([], layout);

    assert.equal(result.ok, true);
    assert.ok(result.ok);
    assert.equal(result.promptPrefix, "");
    assert.ok(!result.promptPrefix.includes("8px spacing grid"));
  } finally {
    await forceRemove(cwd);
  }
});

test("lists every other installed file as an absolute path, excluding the injected SKILL.md itself", async () => {
  const { cwd, layout } = await freshLayout();
  try {
    const entries = [
      fileEntry("plugin.json", manifest("ui-ux-design")),
      fileEntry("skills/ui-ux-design/SKILL.md", REAL_SKILL_MARKDOWN),
      fileEntry("skills/ui-ux-design/references/foundations.md", "# Foundations\n"),
    ];
    const archive = new Uint8Array(Buffer.from("archive-real-3"));
    const digest = createHash("sha256").update(archive).digest("hex");
    await installAgentPlugin({
      archive,
      expectedSha256: digest,
      archiveReader: reader(entries),
      layout: resolveAgentPluginLayout({ cwd, env: {} }),
      workspaceId: WORKSPACE_ID,
    });

    const result = await resolveAgentPluginRefs(["ui-ux-design"], layout);

    assert.equal(result.ok, true);
    assert.ok(result.ok);
    const expectedAbsolutePath = path.join(layout.pluginPackagesDir({ pluginId: "ui-ux-design" }), digest, "skills/ui-ux-design/references/foundations.md");
    assert.ok(result.promptPrefix.includes(expectedAbsolutePath));
    assert.ok(!result.promptPrefix.includes(path.join(layout.pluginPackagesDir({ pluginId: "ui-ux-design" }), digest, "skills/ui-ux-design/SKILL.md")));
  } finally {
    await forceRemove(cwd);
  }
});

test("fails closed with an exact 'not installed' reason when zero packages match", async () => {
  const { cwd, layout } = await freshLayout();
  try {
    await installRealPackage(cwd, "some-other-plugin", "# Other\n", "archive-real-4");

    const result = await resolveAgentPluginRefs(["ui-ux-design"], layout);

    assert.deepEqual(result, {
      ok: false,
      reason:
        "Agent Plugin 'ui-ux-design' is not installed in this workspace — pinned by the composer but not found under any installed package",
    });
  } finally {
    await forceRemove(cwd);
  }
});

test("fails closed with an exact 'not installed' reason when the packages directory does not exist at all", async () => {
  const { cwd, layout } = await freshLayout();
  try {
    const result = await resolveAgentPluginRefs(["ui-ux-design"], layout);

    assert.deepEqual(result, {
      ok: false,
      reason:
        "Agent Plugin 'ui-ux-design' is not installed in this workspace — pinned by the composer but not found under any installed package",
    });
  } finally {
    await forceRemove(cwd);
  }
});

test("fails closed with an exact ambiguity reason naming both digests when two installs share a pluginId", async () => {
  const { cwd, layout } = await freshLayout();
  try {
    const first = await installRealPackage(cwd, "ui-ux-design", "# Variant A\n", "archive-real-5a");
    const second = await installRealPackage(cwd, "ui-ux-design", "# Variant B\n", "archive-real-5b");
    const sortedDigests = [first.archiveDigest, second.archiveDigest].sort();

    const result = await resolveAgentPluginRefs(["ui-ux-design"], layout);

    assert.deepEqual(result, {
      ok: false,
      reason: `Agent Plugin 'ui-ux-design' matches 2 installed packages (digests: ${sortedDigests.join(", ")}) — refusing to guess which one to use`,
    });
  } finally {
    await forceRemove(cwd);
  }
});

/**
 * ---------------------------------------------------------------------------
 * F1.1b (t91, 2026-09-16) — run-start injection reads the activation record STRICTLY
 * ---------------------------------------------------------------------------
 * Before this, the once-per-call read here (`readAgentPluginActivations`) was lenient: a corrupt
 * `activations.json` read as "nothing recorded", so an operator-disabled plugin's SKILL.md still got
 * injected while the file was broken. Injecting guidance SPENDS the plugin the same way a tool call
 * does, so this surface must refuse exactly like the per-call tool gate does.
 */

test("refuses a pinned ref when the activation record cannot be read — and never injects the skill's content", async () => {
  const { cwd, layout } = await freshLayout();
  try {
    await installRealPackage(cwd, "ui-ux-design", REAL_SKILL_MARKDOWN, "archive-refs-corrupt-1");
    await writeFile(path.join(layout.root, "activations.json"), '{"schemaVersion":1,"plugins":{"ui-ux-design":{"enabled":false}}', "utf8");

    const result = await resolveAgentPluginRefs(["ui-ux-design"], layout);

    assert.equal(result.ok, false);
    assert.ok(result.ok === false);
    assert.match(result.reason, /activation record .*could not be read/);
    assert.ok(
      result.reason.startsWith(
        "Agent Plugin 'ui-ux-design' was not loaded: this workspace's activation record could not be read, so whether it is enabled cannot be confirmed (",
      ),
    );
    assert.ok(result.reason.endsWith("). Nothing was injected; repair activations.json and start the run again."));
    assert.ok(!result.reason.includes("8px spacing grid"), "the refusal must never carry the plugin's own skill content");
  } finally {
    await forceRemove(cwd);
  }
});

test("GUARD: a well-formed file with enabled:false still gives the existing 'not enabled' reason, unchanged", async () => {
  const { cwd, layout } = await freshLayout();
  try {
    await installRealPackage(cwd, "ui-ux-design", REAL_SKILL_MARKDOWN, "archive-refs-corrupt-2");
    await setAgentPluginActivation({ workspaceRoot: layout.root, pluginId: "ui-ux-design", enabled: false, actor: "op-1" });

    const result = await resolveAgentPluginRefs(["ui-ux-design"], layout);

    assert.deepEqual(result, {
      ok: false,
      reason:
        "Agent Plugin 'ui-ux-design' is installed in this workspace but is not enabled — it ships with the host and " +
        "stays inactive until an operator turns it on. Enable it before pinning it to a run.",
    });
  } finally {
    await forceRemove(cwd);
  }
});

test("resolves multiple pluginRefIds and joins their sections in pin order", async () => {
  const { cwd, layout } = await freshLayout();
  try {
    await installRealPackage(cwd, "ui-ux-design", "# First plugin\n", "archive-real-6a");
    await installRealPackage(cwd, "second-plugin", "# Second plugin\n", "archive-real-6b");

    const result = await resolveAgentPluginRefs(["ui-ux-design", "second-plugin"], layout);

    assert.equal(result.ok, true);
    assert.ok(result.ok);
    const firstIndex = result.promptPrefix.indexOf("# First plugin");
    const secondIndex = result.promptPrefix.indexOf("# Second plugin");
    assert.ok(firstIndex >= 0 && secondIndex >= 0 && firstIndex < secondIndex);
  } finally {
    await forceRemove(cwd);
  }
});

/**
 * Adversarial aggregate case (adversarial-test-design): a batch of refs where only ONE fails must
 * not silently succeed with a partial prefix — the whole run is meant to abort on the first
 * unresolvable ref, per this module's own "fail closed" header, not quietly proceed with half the
 * pinned plugins reaching the agent and the other half vanishing without a trace.
 */
test("aborts on the first unresolvable ref rather than silently dropping it from a partial success", async () => {
  const { cwd, layout } = await freshLayout();
  try {
    await installRealPackage(cwd, "ui-ux-design", "# First plugin\n", "archive-real-7");

    const result = await resolveAgentPluginRefs(["ui-ux-design", "never-installed"], layout);

    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.match(result.reason, /'never-installed' is not installed/);
  } finally {
    await forceRemove(cwd);
  }
});

test("frames the file inventory as instructions to follow, never as an optional extra to the SKILL.md 'summary' (regression: live runs read 0 of the listed files)", async () => {
  const { cwd, layout } = await freshLayout();
  try {
    const entries = [
      fileEntry("plugin.json", manifest("ui-ux-design")),
      fileEntry("skills/ui-ux-design/SKILL.md", REAL_SKILL_MARKDOWN),
      fileEntry("skills/ui-ux-design/references/premium-ui.md", "# Premium UI\n"),
    ];
    const archive = new Uint8Array(Buffer.from("archive-inventory-framing"));
    await installAgentPlugin({
      archive,
      expectedSha256: createHash("sha256").update(archive).digest("hex"),
      archiveReader: reader(entries),
      layout: resolveAgentPluginLayout({ cwd, env: {} }),
      workspaceId: WORKSPACE_ID,
    });

    const result = await resolveAgentPluginRefs(["ui-ux-design"], layout);
    assert.equal(result.ok, true);
    assert.ok(result.ok);

    // Exact header text, not a loose `includes` on a keyword — the whole defect this test guards
    // was one clause of wording, so the wording itself is the contract.
    assert.ok(
      result.promptPrefix.includes(
        "The SKILL.md above is this Agent Plugin's own instructions — follow them, including any " +
          "files it directs you to load before starting work. Every other file in the installed " +
          "package is listed below by absolute path and is readable now:",
      ),
      `inventory header did not match the expected imperative framing. Actual prefix:\n${result.promptPrefix}`,
    );

    // The two specific phrasings that caused the defect. `resolveAgentPluginRefs` used to call the
    // injected SKILL.md a "summary" and gate the reference files behind "if the task needs more
    // than" it — which directly contradicts what this plugin's own SKILL.md instructs ("loads the
    // premium bundle up front ... Do not wait for the user to name a source"). Measured live on
    // 2026-08-21: with that framing the agent read 0 of 30 listed files; with an explicit
    // instruction to read them it read exactly the 4 the SKILL.md names.
    assert.ok(
      !result.promptPrefix.includes("if the task needs more than"),
      "prefix still gates the plugin's own reference files behind a conditional",
    );
    assert.ok(
      !/summary above/.test(result.promptPrefix),
      "prefix still describes the injected SKILL.md as a 'summary', undercutting its own instructions",
    );
  } finally {
    await forceRemove(cwd);
  }
});

/**
 * `pointer` delivery mode (2026-08-22, redirected 2026-08-26 — see
 * `ADS-memory/knowledge/2026-08-26-removed-capability-search.md`) — the A/B arm that replaces the
 * ~15KB injection with a short mandatory instruction naming the exact `agent_plugin_<pluginId>`
 * call. These tests exist because the pointer's whole value is in properties a "it returns a
 * string" assertion would not catch: the tool id has to be the real installed one, the wording has
 * to stay mandatory, and the bulk content has to genuinely be gone rather than merely shortened.
 */

test("pointer mode emits the exact agent_plugin_<pluginId> tool id tool-registrations.ts mints", async () => {
  const { cwd, layout } = await freshLayout();
  try {
    await installRealPackage(cwd, "ui-ux-design", REAL_SKILL_MARKDOWN, "archive-pointer-1");

    const result = await resolveAgentPluginRefs(["ui-ux-design"], layout, "pointer");

    assert.ok(result.ok);
    // The install digest plays no part in this id (see `tool-registrations.ts`'s own header on why
    // the digest is deliberately not folded into a plugin tool's id) — hyphens simply fold to
    // underscores.
    assert.ok(
      result.promptPrefix.includes("agent_plugin_ui_ux_design"),
      `pointer must name the real installed tool id; got:\n${result.promptPrefix}`,
    );
  } finally {
    await forceRemove(cwd);
  }
});

test("pointer mode names the proxied bridge call, because the plugin tool is not in the agent's own namespace", async () => {
  const { cwd, layout } = await freshLayout();
  try {
    await installRealPackage(cwd, "ui-ux-design", REAL_SKILL_MARKDOWN, "archive-pointer-2");

    const result = await resolveAgentPluginRefs(["ui-ux-design"], layout, "pointer");

    assert.ok(result.ok);
    // Measured live 2026-08-22: the spawned agent reaches the host tools only through Jini's MCP proxy
    // and burned five discovery hops finding that route. A pointer naming only the bare tool would
    // name something that does not exist from the agent's side.
    assert.ok(result.promptPrefix.includes("agent_plugin_ui_ux_design({})"));
    assert.ok(result.promptPrefix.includes('mcp__jini__execute_delegated_tool({ "toolId": "agent_plugin_ui_ux_design", "input": {} })'));
  } finally {
    await forceRemove(cwd);
  }
});

test("pointer mode keeps the instruction MANDATORY and never calls the content optional or a summary", async () => {
  const { cwd, layout } = await freshLayout();
  try {
    await installRealPackage(cwd, "ui-ux-design", REAL_SKILL_MARKDOWN, "archive-pointer-3");

    const result = await resolveAgentPluginRefs(["ui-ux-design"], layout, "pointer");

    assert.ok(result.ok);
    assert.ok(result.promptPrefix.includes("MANDATORY"));
    // The exact regression the 0-of-30 measurement produced: framing that hedges gets skipped. The
    // pointer must not contain the hedging vocabulary at all — not even negated, since "not
    // optional" still puts the word in front of the model.
    assert.ok(!/\boptional\b/i.test(result.promptPrefix), "pointer must not use the word 'optional'");
    assert.ok(!/\bsummary\b(?! —)/i.test(result.promptPrefix.replace("not a summary", "")), "pointer must not call the content a summary");
    assert.ok(!/\bif (the task needs|you need)\b/i.test(result.promptPrefix), "pointer must not make the call conditional");
  } finally {
    await forceRemove(cwd);
  }
});

test("pointer mode omits the SKILL.md body entirely — the payload is what moves behind the tool call", async () => {
  const { cwd, layout } = await freshLayout();
  try {
    await installRealPackage(cwd, "ui-ux-design", REAL_SKILL_MARKDOWN, "archive-pointer-4");

    const injected = await resolveAgentPluginRefs(["ui-ux-design"], layout, "inject");
    const pointed = await resolveAgentPluginRefs(["ui-ux-design"], layout, "pointer");

    assert.ok(injected.ok);
    assert.ok(pointed.ok);
    assert.ok(injected.promptPrefix.includes("8px spacing grid"));
    assert.ok(!pointed.promptPrefix.includes("8px spacing grid"));
    assert.ok(
      pointed.promptPrefix.length < injected.promptPrefix.length,
      "pointer must be smaller than the injection it replaces",
    );
  } finally {
    await forceRemove(cwd);
  }
});

test("pointer mode fails closed with the same reason as inject when the eponymous skill is missing", async () => {
  const { cwd, layout } = await freshLayout();
  try {
    // A package whose only skill folder is named something OTHER than the plugin id: `inject`
    // already fails here (no readable skills/<id>/SKILL.md), and `pointer` must not silently
    // succeed by emitting a well-formed call to a card that can never resolve.
    const entries = [
      fileEntry("plugin.json", manifest("ui-ux-design")),
      fileEntry("skills/some-other-skill/SKILL.md", REAL_SKILL_MARKDOWN),
    ];
    const archive = new Uint8Array(Buffer.from("archive-pointer-5"));
    await installAgentPlugin({
      archive,
      expectedSha256: createHash("sha256").update(archive).digest("hex"),
      archiveReader: reader(entries),
      layout: resolveAgentPluginLayout({ cwd, env: {} }),
      workspaceId: WORKSPACE_ID,
    });

    const pointed = await resolveAgentPluginRefs(["ui-ux-design"], layout, "pointer");
    const injected = await resolveAgentPluginRefs(["ui-ux-design"], layout, "inject");

    assert.equal(pointed.ok, false);
    assert.equal(injected.ok, false);
    assert.ok(!pointed.ok);
    assert.match(pointed.reason, /has no readable 'skills\/ui-ux-design\/SKILL\.md'/);
  } finally {
    await forceRemove(cwd);
  }
});

test("delivery mode defaults to inject, and an unrecognised env value never flips it", async () => {
  assert.equal(resolveAgentPluginDeliveryMode({}), "inject");
  assert.equal(resolveAgentPluginDeliveryMode({ PLUGIN_DELIVERY: undefined }), "inject");
  assert.equal(resolveAgentPluginDeliveryMode({ PLUGIN_DELIVERY: "Pointer" }), "inject");
  assert.equal(resolveAgentPluginDeliveryMode({ PLUGIN_DELIVERY: "inject" }), "inject");
  assert.equal(resolveAgentPluginDeliveryMode({ PLUGIN_DELIVERY: "pointer" }), "pointer");
});
