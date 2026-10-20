import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentCliLogSources, buildRunEventLogSources } from "../agent-logs.js";
import { createNodeDiagnosticsPorts } from "../node-ports.js";
import { collectLogSources } from "../sources.js";
import { discoveryFilesystem } from "./l170-filesystem.fake.js";

const defaultTail = 2 * 1024 * 1024;

describe("run log discovery characterization", () => {
  it.each([null, undefined, ""])("does not read a missing runs directory (%s)", async (runsDir) => {
    const directoryReads: string[] = [];
    const filesystem = discoveryFilesystem({ directories: {}, stats: {} }, { directoryReads });
    expect(await buildRunEventLogSources({ runsDir, filesystem })).toEqual([]);
    expect(directoryReads).toEqual([]);
  });

  it("treats a failed directory read as no run logs", async () => {
    const filesystem = discoveryFilesystem({ directories: { "/runs": new Error("denied") }, stats: {} });
    expect(await buildRunEventLogSources({ runsDir: "/runs", filesystem })).toEqual([]);
  });

  it("keeps safe directories with regular event files, orders ties stably, and tails by default", async () => {
    const statReads: string[] = [];
    const filesystem = discoveryFilesystem({
      directories: { "/runs": [
        { name: "notes", isDirectory: false }, { name: "bad/name", isDirectory: true },
        { name: "bad name", isDirectory: true }, { name: "missing", isDirectory: true },
        { name: "directory", isDirectory: true }, { name: "older", isDirectory: true },
        { name: "new-a", isDirectory: true }, { name: "new_b.2", isDirectory: true },
      ] },
      stats: {
        "/runs/missing/events.jsonl": new Error("gone"),
        "/runs/directory/events.jsonl": { isFile: false, mtimeMs: 9 },
        "/runs/older/events.jsonl": { isFile: true, mtimeMs: 1 },
        "/runs/new-a/events.jsonl": { isFile: true, mtimeMs: 2 },
        "/runs/new_b.2/events.jsonl": { isFile: true, mtimeMs: 2 },
      },
    }, { statReads });
    expect(await buildRunEventLogSources({ runsDir: "/runs", filesystem })).toEqual([
      { name: "runs/new-a/events.jsonl", absolutePath: "/runs/new-a/events.jsonl", kind: "text", tailBytes: defaultTail },
      { name: "runs/new_b.2/events.jsonl", absolutePath: "/runs/new_b.2/events.jsonl", kind: "text", tailBytes: defaultTail },
      { name: "runs/older/events.jsonl", absolutePath: "/runs/older/events.jsonl", kind: "text", tailBytes: defaultTail },
    ]);
    expect(statReads).toEqual([
      "/runs/missing/events.jsonl", "/runs/directory/events.jsonl", "/runs/older/events.jsonl",
      "/runs/new-a/events.jsonl", "/runs/new_b.2/events.jsonl",
    ]);
  });

  it.each([{ maxRuns: 1, count: 1 }, { maxRuns: 0, count: 0 }, { maxRuns: -1, count: 2 }])(
    "preserves slice semantics for maxRuns=$maxRuns and a zero tail", async ({ maxRuns, count }) => {
      const filesystem = discoveryFilesystem({
        directories: { "/runs": ["a", "b", "c"].map((name) => ({ name, isDirectory: true })) },
        stats: {
          "/runs/a/events.jsonl": { isFile: true, mtimeMs: 3 },
          "/runs/b/events.jsonl": { isFile: true, mtimeMs: 2 },
          "/runs/c/events.jsonl": { isFile: true, mtimeMs: 1 },
        },
      });
      const result = await buildRunEventLogSources({ runsDir: "/runs", filesystem }, { maxRuns, tailBytes: 0 });
      expect(result).toEqual(["a", "b", "c"].slice(0, count).map((name) => ({
        name: `runs/${name}/events.jsonl`, absolutePath: `/runs/${name}/events.jsonl`, kind: "text", tailBytes: 0,
      })));
    },
  );

  it("limits default run discovery to the newest twenty", async () => {
    const directories = { "/runs": Array.from({ length: 21 }, (_, n) => ({ name: String(n), isDirectory: true })) };
    const stats = Object.fromEntries(Array.from({ length: 21 }, (_, n) => [
      `/runs/${n}/events.jsonl`, { isFile: true, mtimeMs: n },
    ]));
    const filesystem = discoveryFilesystem({ directories, stats });
    const result = await buildRunEventLogSources({ runsDir: "/runs", filesystem });
    expect(result.map(({ name }) => name)).toEqual(Array.from({ length: 20 }, (_, n) => `runs/${20 - n}/events.jsonl`));
  });
});

describe("agent CLI log discovery characterization", () => {
  it("collects a .log symlink's target outside the log directory (reported, not fixed)", async () => {
    const root = await mkdtemp(join(tmpdir(), "diagnostics-l170-"));
    try {
      const homeDir = join(root, "home");
      const logDir = join(homeDir, ".claude");
      const target = join(root, "private.json");
      const absolutePath = join(logDir, "linked.log");
      await mkdir(logDir, { recursive: true });
      await writeFile(target, '{"privateNote":"outside the log directory"}');
      await symlink(target, absolutePath);
      const { filesystem } = createNodeDiagnosticsPorts({});
      const sources = await buildAgentCliLogSources({ homeDir, filesystem });
      expect(sources).toEqual([{
        name: "agent-cli-logs/claude/linked.log", absolutePath, kind: "text", tailBytes: defaultTail,
      }]);
      expect(await collectLogSources({ sources, filesystem })).toEqual([{
        name: "agent-cli-logs/claude/linked.log", absolutePath,
        content: '{"privateNote":"outside the log directory"}',
        bytes: Buffer.byteLength('{"privateNote":"outside the log directory"}'),
      }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["", "   "])("does not scan when the trimmed home is empty (%s)", async (homeDir) => {
    const directoryReads: string[] = [];
    const filesystem = discoveryFilesystem({ directories: {}, stats: {} }, { directoryReads });
    expect(await buildAgentCliLogSources({ homeDir, filesystem }, { amrOpenCodeHome: "/amr" })).toEqual([]);
    expect(directoryReads).toEqual([]);
  });

  it("uses trimmed default homes, skips failed directories and unsafe/non-log/non-file entries", async () => {
    const directoryReads: string[] = [];
    const statReads: string[] = [];
    const filesystem = discoveryFilesystem({
      directories: {
        "/home/test/.claude": [
          { name: "auth.json", isDirectory: false }, { name: "upper.LOG", isDirectory: false },
          { name: "unsafe name.log", isDirectory: false }, { name: "../outside.log", isDirectory: false },
          { name: "missing.log", isDirectory: false }, { name: "directory.log", isDirectory: true },
          { name: "old.log", isDirectory: false }, { name: "new.log", isDirectory: false },
          { name: "tie.log", isDirectory: false }, { name: "last.log", isDirectory: false },
        ],
        "/home/test/.codex/log": new Error("denied"),
        "/home/test/.local/share/opencode/log": [{ name: "session.log", isDirectory: false }],
      },
      stats: {
        "/home/test/.claude/missing.log": new Error("gone"),
        "/home/test/.claude/directory.log": { isFile: false, mtimeMs: 99 },
        "/home/test/.claude/old.log": { isFile: true, mtimeMs: 2 },
        "/home/test/.claude/new.log": { isFile: true, mtimeMs: 3 },
        "/home/test/.claude/tie.log": { isFile: true, mtimeMs: 3 },
        "/home/test/.claude/last.log": { isFile: true, mtimeMs: 1 },
        "/home/test/.local/share/opencode/log/session.log": { isFile: true, mtimeMs: 100 },
      },
    }, { directoryReads, statReads });
    expect(await buildAgentCliLogSources({ homeDir: " /home/test ", filesystem })).toEqual([
      { name: "agent-cli-logs/claude/new.log", absolutePath: "/home/test/.claude/new.log", kind: "text", tailBytes: defaultTail },
      { name: "agent-cli-logs/claude/tie.log", absolutePath: "/home/test/.claude/tie.log", kind: "text", tailBytes: defaultTail },
      { name: "agent-cli-logs/claude/old.log", absolutePath: "/home/test/.claude/old.log", kind: "text", tailBytes: defaultTail },
      { name: "agent-cli-logs/opencode/session.log", absolutePath: "/home/test/.local/share/opencode/log/session.log", kind: "text", tailBytes: defaultTail },
    ]);
    expect(directoryReads).toEqual(["/home/test/.claude", "/home/test/.codex/log", "/home/test/.local/share/opencode/log"]);
    expect(statReads).toEqual([
      "/home/test/.claude/missing.log", "/home/test/.claude/directory.log", "/home/test/.claude/old.log",
      "/home/test/.claude/new.log", "/home/test/.claude/tie.log", "/home/test/.claude/last.log",
      "/home/test/.local/share/opencode/log/session.log",
    ]);
  });

  it("honors trimmed CLI/XDG overrides and the explicit AMR home ahead of dataDir", async () => {
    const dirs = ["/claude", "/codex/log", "/xdg/opencode/log", "/amr/.local/share/opencode/log"];
    const filesystem = discoveryFilesystem({
      directories: Object.fromEntries(dirs.map((dir) => [dir, [{ name: "session.log", isDirectory: false }]])),
      stats: Object.fromEntries(dirs.map((dir) => [`${dir}/session.log`, { isFile: true, mtimeMs: 1 }])),
    });
    expect(await buildAgentCliLogSources({ homeDir: "/home/test", filesystem }, {
      claudeConfigDir: " /claude ", codexHome: " /codex ", xdgDataHome: " /xdg ",
      amrOpenCodeHome: " /amr ", dataDir: " /unused ", tailBytes: 17, maxFilesPerAgent: 1,
    })).toEqual(dirs.map((dir, index) => ({
      name: `agent-cli-logs/${["claude", "codex", "opencode", "amr"][index]}/session.log`,
      absolutePath: `${dir}/session.log`, kind: "text", tailBytes: 17,
    })));
  });

  it("falls back from blank overrides and derives the AMR home from trimmed dataDir", async () => {
    const directoryReads: string[] = [];
    const filesystem = discoveryFilesystem({ directories: {}, stats: {} }, { directoryReads });
    expect(await buildAgentCliLogSources({ homeDir: "/home/test", filesystem }, {
      claudeConfigDir: " ", codexHome: " ", xdgDataHome: " ", amrOpenCodeHome: " ", dataDir: " /data ",
    })).toEqual([]);
    expect(directoryReads).toEqual([
      "/home/test/.claude", "/home/test/.codex/log", "/home/test/.local/share/opencode/log",
      "/data/amr/opencode-home/.local/share/opencode/log",
    ]);
  });

  it.each([0, -1])("preserves per-agent maxFilesPerAgent=%s and zero tail semantics", async (maxFilesPerAgent) => {
    const filesystem = discoveryFilesystem({
      directories: { "/home/test/.claude": ["a.log", "b.log"].map((name) => ({ name, isDirectory: false })) },
      stats: {
        "/home/test/.claude/a.log": { isFile: true, mtimeMs: 2 },
        "/home/test/.claude/b.log": { isFile: true, mtimeMs: 1 },
      },
    });
    const expected = maxFilesPerAgent === 0 ? [] : [{
      name: "agent-cli-logs/claude/a.log", absolutePath: "/home/test/.claude/a.log", kind: "text", tailBytes: 0,
    }];
    expect(await buildAgentCliLogSources({ homeDir: "/home/test", filesystem }, { maxFilesPerAgent, tailBytes: 0 })).toEqual(expected);
  });
});
