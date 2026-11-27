import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";

import {
  MAX_HOST_PLUGIN_FILE_BYTES,
  deliverHostPluginGuidance,
  isHostPluginFileRequest,
  readHostPluginFile,
  readHostPluginGuidance,
  readHostPluginRefOverlays,
  removeChatRefusedToolPermissions,
  splitHostPluginRefRequest,
} from "../host-plugin-guidance.js";

/**
 * @file The host overlay formatter (`host-plugin-guidance.ts`): reads of
 * `GUIDANCE.md` and `host/<name>.md` under a real temp overlays directory, their refusals and
 * 256 KiB bound, the delivered-text Bash removal (w1 ui-ux wording), and the two seam helpers. The
 * seams themselves are driven end to end by the host that binds them (its tool path and run references).
 */

const GUIDANCE = "# Host guidance for roastery\n\nUse brew_log for every brew.";
const RATIOS = "# Brew ratios\n\n1:16 for pour-over.";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

/** A temp overlays root with one plugin overlay; extra files are written relative to the plugin dir. */
async function overlays(_t: unknown, files: Readonly<Record<string, string>> = { "GUIDANCE.md": GUIDANCE, "host/brew-ratios.md": RATIOS }) {
  const root = await mkdtemp(path.join(tmpdir(), "jini-host-plugin-guidance-"));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, "roastery", name)), { recursive: true });
    await writeFile(path.join(root, "roastery", name), text);
  }
  return root;
}

test("a plugin without an overlay reads as no guidance and no host files, and delivery leaves the answer unchanged", async t => {
  const overlaysDir = await overlays(t, {});
  assert.deepEqual(await readHostPluginGuidance({ pluginId: "other", overlaysDir }), { files: [] });
  assert.deepEqual(await readHostPluginGuidance({ pluginId: "roastery", overlaysDir: path.join(overlaysDir, "missing-root") }), { files: [] });
  const result = { pluginId: "other", guidance: "SKILL", files: ["references/a.md"] };
  assert.deepEqual(await deliverHostPluginGuidance({ result, overlaysDir }), { guidance: "SKILL", files: ["references/a.md"] });
});

test("guidance and sorted host files are read; names outside host/<lowercase>.md and non-files are not listed", async t => {
  const overlaysDir = await overlays(t, {
    "GUIDANCE.md": GUIDANCE, "host/z-last.md": "Z", "host/brew-ratios.md": RATIOS,
    "host/Upper.md": "no", "host/notes.txt": "no", "host/nested/inner.md": "no", "host/.hidden.md": "no",
  });
  assert.deepEqual(await readHostPluginGuidance({ pluginId: "roastery", overlaysDir }), {
    guidance: GUIDANCE, files: ["host/brew-ratios.md", "host/z-last.md"],
  });
});

test("a host file reads by name; traversal, absolute, unlisted and unknown-plugin requests return a note that never echoes the unsafe value", async t => {
  const overlaysDir = await overlays(t);
  assert.deepEqual(await readHostPluginFile({ pluginId: "roastery", file: "host/brew-ratios.md", overlaysDir }), { text: RATIOS });
  for (const file of ["host/../GUIDANCE.md", "/etc/passwd", "host//etc/passwd", "host/Upper.md", "GUIDANCE.md"]) {
    const read = await readHostPluginFile({ pluginId: "roastery", file, overlaysDir });
    assert.ok("note" in read, file);
    assert.equal(read.note.includes(file), false, `${file} must not be echoed`);
    assert.match(read.note, /Valid host files: host\/brew-ratios\.md\./);
  }
  const missing = await readHostPluginFile({ pluginId: "roastery", file: "host/missing.md", overlaysDir });
  assert.deepEqual(missing, { note: "Host file 'host/missing.md' is not available for the 'roastery' plugin. Valid host files: host/brew-ratios.md." });
  for (const pluginId of ["../roastery", "/abs", "Roastery"]) {
    assert.deepEqual(await readHostPluginGuidance({ pluginId, overlaysDir }), { files: [] });
    const read = await readHostPluginFile({ pluginId, file: "host/brew-ratios.md", overlaysDir });
    assert.ok("note" in read);
    assert.match(read.note, /Valid host files: \(none\)\./);
  }
});

test("reads are bounded at 256 KiB: a host file over the cap is a note, at the cap it reads, and an oversized GUIDANCE.md throws", async t => {
  const atCap = "a".repeat(MAX_HOST_PLUGIN_FILE_BYTES);
  const overlaysDir = await overlays(t, { "host/at-cap.md": atCap, "host/over-cap.md": `${atCap}b` });
  assert.deepEqual(await readHostPluginFile({ pluginId: "roastery", file: "host/at-cap.md", overlaysDir }), { text: atCap });
  const over = await readHostPluginFile({ pluginId: "roastery", file: "host/over-cap.md", overlaysDir });
  assert.deepEqual(over, { note: `Host file 'host/over-cap.md' is over ${MAX_HOST_PLUGIN_FILE_BYTES} bytes for the 'roastery' plugin. Valid host files: host/at-cap.md, host/over-cap.md.` });
  const oversized = await overlays(t, { "GUIDANCE.md": `${atCap}b` });
  await assert.rejects(readHostPluginGuidance({ pluginId: "roastery", overlaysDir: oversized }), /GUIDANCE\.md is over 262144 bytes/);
});

test("a GUIDANCE.md that is not a file is a broken overlay and throws rather than silently dropping host rules", async t => {
  const overlaysDir = await overlays(t, { "GUIDANCE.md/inner.md": "x" });
  await assert.rejects(readHostPluginGuidance({ pluginId: "roastery", overlaysDir }), /not a file: GUIDANCE\.md/);
});

test("only file values starting with host/ are host requests", () => {
  assert.equal(isHostPluginFileRequest({ file: "host/brew-ratios.md" }), true);
  assert.equal(isHostPluginFileRequest({ file: "host/../x" }), true, "routed to the overlay reader, which refuses it");
  for (const file of ["references/a.md", "SKILL.md", "/host/a.md", undefined, 3]) assert.equal(isHostPluginFileRequest({ file }), false);
});

const SHADCN = `---
name: shadcn-ui
description: Expert guidance.
allowed-tools:
  - "shadcn*:*"
  - "Read"
  - "Bash"
  - "web_fetch"
---

# shadcn

Run \`npx shadcn add button\` in a coding checkout.

\`\`\`yaml
---
allowed-tools:
  - "Bash"
---
\`\`\`
`;

test("Bash leaves delivered frontmatter allowed-tools only; other tools, body text and fenced examples stay byte-identical", () => {
  const delivered = removeChatRefusedToolPermissions({ text: SHADCN });
  assert.equal(delivered, SHADCN.replace('  - "Bash"\n  - "web_fetch"', '  - "web_fetch"'));
  assert.match(delivered, /```yaml\n---\nallowed-tools:\n {2}- "Bash"\n---\n```/, "an example is not delivered frontmatter");
  const section = `<<AGENT_PLUGIN pluginId="ui-ux-design">>\n${SHADCN}\n<</AGENT_PLUGIN>>`;
  assert.doesNotMatch(removeChatRefusedToolPermissions({ text: section }).split("```yaml")[0]!, /"Bash"/);
  const notice = `Caution.\n\n${SHADCN}`;
  assert.doesNotMatch(removeChatRefusedToolPermissions({ text: notice }).split("```yaml")[0]!, /"Bash"/);
  for (const text of ["# No frontmatter\n\n- Bash", "---\nname: x\nallowed-tools: Read, Bash\n---\n", "---\nname: x\ntools:\n  - Bash\n---\n"]) {
    assert.equal(removeChatRefusedToolPermissions({ text }), text);
  }
});

test("Markdown rules before another plugin do not hide its refused tool permissions", () => {
  const body = '# Host instructions\n\n---\n\nUse the supported tools.\n\n';
  const skill = '---\nname: next-plugin\nallowed-tools:\n  - "Read"\n  - "Bash"\n---\n\n# Next plugin';
  const framed = `${body}<<AGENT_PLUGIN pluginId="next-plugin">>\n${skill}\n<</AGENT_PLUGIN>>`;
  assert.equal(removeChatRefusedToolPermissions({ text: framed }), framed.replace('  - "Bash"\n', ''));
  assert.equal(removeChatRefusedToolPermissions({ text: body + skill }), (body + skill).replace('  - "Bash"\n', ''));
});

test("Markdown rules and fenced frontmatter examples leave body Bash lists unchanged", () => {
  const body = '# Instructions\n\n---\n\nallowed-tools:\n  - "Bash"\n\n```yaml\n\n---\nname: example\nallowed-tools:\n  - "Bash"\n---\n```\n';
  assert.equal(removeChatRefusedToolPermissions({ text: body }), body);
});

test("frontmatter with leading YAML comments or blank lines still removes refused tools", () => {
  for (const lead of ["\n", "# Tool permissions\n\n"]) {
    const skill = `---\n${lead}name: commented\nallowed-tools:\n  - Bash\n  - Read\n---\n# Body`;
    assert.equal(removeChatRefusedToolPermissions({ text: skill }), skill.replace('  - Bash\n', ''));
  }
});

test("tool delivery: GUIDANCE goes before the plugin's text, a maturity notice stays first, and host names join the plugin's files", async t => {
  const overlaysDir = await overlays(t);
  const result = { pluginId: "roastery", guidance: "SKILL", files: ["references/a.md"], note: "plugin note" };
  assert.deepEqual(await deliverHostPluginGuidance({ result, overlaysDir }), {
    guidance: `${GUIDANCE}\n\nSKILL`, files: ["references/a.md", "host/brew-ratios.md"], note: "plugin note",
  });
  const untested = { ...result, guidance: "CAUTION\n\nSKILL" };
  assert.equal((await deliverHostPluginGuidance({ result: untested, overlaysDir }, { notice: "CAUTION" })).guidance, `CAUTION\n\n${GUIDANCE}\n\nSKILL`);
  assert.equal((await deliverHostPluginGuidance({ result, overlaysDir }, { notice: "CAUTION" })).guidance, `${GUIDANCE}\n\nSKILL`, "an absent notice is not invented");
});

test("tool delivery of a host file answers with that file after the notice; a refused name keeps the default answer and adds a note", async t => {
  const overlaysDir = await overlays(t);
  const result = { pluginId: "roastery", guidance: "CAUTION\n\nSKILL", files: [] };
  assert.deepEqual(await deliverHostPluginGuidance({ result, file: "host/brew-ratios.md", overlaysDir }, { notice: "CAUTION" }), {
    guidance: `CAUTION\n\n${RATIOS}`, files: ["host/brew-ratios.md"],
  });
  const refused = await deliverHostPluginGuidance({ result: { ...result, note: "first" }, file: "host/../GUIDANCE.md", overlaysDir }, { notice: "CAUTION" });
  assert.equal(refused.guidance, `CAUTION\n\n${GUIDANCE}\n\nSKILL`);
  assert.equal(refused.note, "first Host file is not available for the 'roastery' plugin. Valid host files: host/brew-ratios.md.");
});

test("run-reference requests: the owner never sees a host file; pointer delivery with nothing selected adds no guidance", () => {
  assert.deepEqual(splitHostPluginRefRequest({ options: { skill: "s", file: "host/a.md", deliveryMode: "inject" }, defaultDeliveryMode: "inject" }),
    { ownerOptions: { skill: "s", deliveryMode: "inject" }, overlay: { includeGuidance: true, file: "host/a.md" } });
  assert.deepEqual(splitHostPluginRefRequest({ options: { file: "references/a.md" }, defaultDeliveryMode: "pointer" }),
    { ownerOptions: { file: "references/a.md" }, overlay: { includeGuidance: true } });
  assert.deepEqual(splitHostPluginRefRequest({ options: {}, defaultDeliveryMode: "pointer" }), { ownerOptions: {}, overlay: { includeGuidance: false } });
  assert.deepEqual(splitHostPluginRefRequest({ options: { deliveryMode: "inject" }, defaultDeliveryMode: "pointer" }).overlay, { includeGuidance: true });
  assert.deepEqual(splitHostPluginRefRequest({ options: { skill: "s" }, defaultDeliveryMode: "pointer" }).overlay, { includeGuidance: true });
});

test("run-reference overlays keep pin order, frame a host file with its plugin, and refuse a missing host file like a missing plugin file", async t => {
  const overlaysDir = await overlays(t);
  await mkdir(path.join(overlaysDir, "kettle"), { recursive: true });
  await writeFile(path.join(overlaysDir, "kettle", "GUIDANCE.md"), "KETTLE");
  assert.deepEqual(await readHostPluginRefOverlays({ pluginRefIds: ["kettle", "none", "roastery"], includeGuidance: true, overlaysDir }),
    { ok: true, guidance: ["KETTLE", GUIDANCE], fileSections: [] });
  assert.deepEqual(await readHostPluginRefOverlays({ pluginRefIds: ["roastery"], includeGuidance: false, file: "host/brew-ratios.md", overlaysDir }),
    { ok: true, guidance: [], fileSections: [`Host file host/brew-ratios.md for Agent Plugin 'roastery':\n${RATIOS}`] });
  const refused = await readHostPluginRefOverlays({ pluginRefIds: ["roastery", "kettle"], includeGuidance: true, file: "host/brew-ratios.md", overlaysDir });
  assert.deepEqual(refused, { ok: false, reason: "Host file 'host/brew-ratios.md' is not available for the 'kettle' plugin. Valid host files: (none)." });
});

test("a broken host-file directory propagates its filesystem diagnostic instead of silently dropping the overlay", async t => {
  const overlaysDir = await overlays(t, { "GUIDANCE.md": GUIDANCE, host: "not a directory" });
  await assert.rejects(readHostPluginGuidance({ pluginId: "roastery", overlaysDir }), { code: "ENOTDIR" });
});
