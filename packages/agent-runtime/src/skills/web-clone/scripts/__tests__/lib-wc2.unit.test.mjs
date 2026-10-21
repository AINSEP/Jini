import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { HELP_OPTIONS, int, num, parseCliArgs, text } from "../lib/cli-args.mjs";
import { exitOnFailure, isMainModule, runCli, runIfMain } from "../lib/main-guard.mjs";
import { launchChromium, loadPlaywright } from "../lib/playwright-loader.mjs";
import { tempDir } from "./fakes-wc2.mjs";

describe("parseCliArgs", () => {
  const spec = {
    defaults: { url: "", wait: 5, steps: 7, quiet: false },
    options: {
      ...HELP_OPTIONS,
      "--url": { key: "url", parse: text("none") },
      "--wait": { key: "wait", parse: num("5") },
      "--steps": { key: "steps", parse: int("7") },
      "--quiet": { key: "quiet", flag: true },
    },
  };

  it("overlays parsed values on a copy of the defaults", () => {
    const parsed = parseCliArgs({ argv: ["--url", "u", "--wait", "1.5", "--steps", "12px", "--quiet", "-h"], ...spec });
    expect(parsed).toEqual({ url: "u", wait: 1.5, steps: 12, quiet: true, help: true });
    expect(spec.defaults).toEqual({ url: "", wait: 5, steps: 7, quiet: false });
  });

  it("uses each option's fallback when the value is missing or empty", () => {
    expect(parseCliArgs({ argv: ["--url", "", "--steps"], ...spec })).toMatchObject({ url: "none", steps: 7 });
    expect(parseCliArgs({ argv: ["--wait"], ...spec }).wait).toBe(5);
  });

  it("throws on unknown arguments in strict mode, including prototype keys", () => {
    expect(() => parseCliArgs({ argv: ["--nope"], ...spec })).toThrow("Unexpected argument: --nope");
    expect(() => parseCliArgs({ argv: ["constructor"], ...spec })).toThrow("Unexpected argument: constructor");
  });

  it("skips unknown arguments without consuming a value in non-strict mode", () => {
    expect(parseCliArgs({ argv: ["--extra", "--url", "u"], ...spec }, { strict: false })).toMatchObject({ url: "u" });
  });
});

describe("main guard", () => {
  it("isMainModule matches the entry path, resolving symlinks", () => {
    const dir = tempDir();
    const real = path.join(dir, "real.mjs");
    const link = path.join(dir, "link.mjs");
    fs.writeFileSync(real, "");
    fs.symlinkSync(real, link);
    const url = pathToFileURL(fs.realpathSync(real)).href;
    expect(isMainModule({ moduleUrl: url, argv1: link })).toBe(true);
    expect(isMainModule({ moduleUrl: url, argv1: path.join(dir, "other.mjs") })).toBe(false);
    expect(isMainModule({ moduleUrl: url, argv1: undefined })).toBe(false);
  });

  it("isMainModule compares the path as given when it cannot be resolved", () => {
    const missing = path.join(tempDir(), "gone.mjs");
    const failing = () => {
      throw new Error("ENOENT");
    };
    expect(isMainModule({ moduleUrl: pathToFileURL(missing).href, argv1: missing }, { realpath: failing })).toBe(true);
  });

  it("runIfMain runs main with the trailing argv and hands its code to onExit", async () => {
    const exits = [];
    const seen = [];
    const main = async ({ argv }) => {
      seen.push(argv);
      return 3;
    };
    const url = "file:///scripts/x.mjs";
    const realpath = (p) => p;
    expect(await runIfMain({ moduleUrl: url, main }, { argv: ["node", "/scripts/x.mjs", "--a"], realpath, onExit: ({ code }) => exits.push(code) })).toBe(true);
    expect(await runIfMain({ moduleUrl: url, main }, { argv: ["node", "/scripts/y.mjs"], realpath, onExit: ({ code }) => exits.push(code) })).toBe(false);
    expect(seen).toEqual([["--a"]]);
    expect(exits).toEqual([3]);
  });

  it("runIfMain defaults to process.argv, which is not this module under the test runner", async () => {
    expect(await runIfMain({ moduleUrl: "file:///not-the-entry.mjs", main: async () => 0 })).toBe(false);
  });

  it("exitOnFailure exits only for a non-zero code", () => {
    const exits = [];
    const proc = { exit: (code) => exits.push(code) };
    exitOnFailure({ code: 0 }, { proc });
    exitOnFailure({ code: 2 }, { proc });
    expect(exits).toEqual([2]);
  });

  it("runCli returns the body's code, or reports the error and returns 1", async () => {
    const reports = [];
    expect(await runCli({ label: "tool", body: async () => 0, report: (m) => reports.push(m) })).toBe(0);
    expect(
      await runCli({ label: "tool", body: () => {
        throw new Error("boom");
      }, report: (m) => reports.push(m) }),
    ).toBe(1);
    expect(reports).toEqual(["tool failed: boom"]);
  });
});

describe("loadPlaywright", () => {
  const fail = (name) => () => {
    throw new Error(`no ${name}`);
  };

  it("prefers the script-relative install", () => {
    const pw = { from: "script" };
    expect(loadPlaywright({ requireFromScript: () => pw, requireFromCwd: fail("cwd"), env: {} })).toBe(pw);
  });

  it("falls back to the cwd install, then AGENT_PLAYWRIGHT_PATH", () => {
    const pw = { from: "cwd" };
    expect(loadPlaywright({ requireFromScript: fail("script"), requireFromCwd: (id) => (id === "playwright" ? pw : null), env: {} })).toBe(pw);
    const shared = { from: "env" };
    const requireFromScript = (id) => {
      if (id === "/opt/pw") return shared;
      throw new Error("not found");
    };
    expect(loadPlaywright({ requireFromScript, requireFromCwd: fail("cwd"), env: { AGENT_PLAYWRIGHT_PATH: "/opt/pw" } })).toBe(shared);
  });

  it("explains how to install Playwright when every candidate fails", () => {
    expect(() => loadPlaywright({ requireFromScript: fail("script"), requireFromCwd: fail("cwd"), env: {} })).toThrow(
      /Playwright not found\. Fix \(run in the project root, once per project\):\n {2}npm install -D playwright/,
    );
  });

  it("resolves with the real require/env defaults (result depends on the install)", () => {
    let outcome;
    try {
      outcome = typeof loadPlaywright().chromium;
    } catch (error) {
      outcome = error.message.split("\n")[0];
    }
    expect(["object", "Playwright not found. Fix (run in the project root, once per project):"]).toContain(outcome);
  });
});

describe("launchChromium", () => {
  it("launches headless bundled Chromium first", async () => {
    const calls = [];
    const chromium = { launch: async (options) => (calls.push(options), "browser") };
    expect(await launchChromium(chromium)).toBe("browser");
    expect(calls).toEqual([{ headless: true }]);
  });

  it("falls back to the system Chrome channel", async () => {
    const calls = [];
    const chromium = {
      launch: async (options) => {
        calls.push(options);
        if (!options.channel) throw new Error("missing browser");
        return "chrome";
      },
    };
    expect(await launchChromium(chromium)).toBe("chrome");
    expect(calls).toEqual([{ headless: true }, { headless: true, channel: "chrome" }]);
  });

  it("rethrows the first (more useful) error when both launches fail", async () => {
    let n = 0;
    const chromium = {
      launch: async () => {
        n += 1;
        throw new Error(`launch ${n}`);
      },
    };
    await expect(launchChromium(chromium)).rejects.toThrow("launch 1");
  });
});
