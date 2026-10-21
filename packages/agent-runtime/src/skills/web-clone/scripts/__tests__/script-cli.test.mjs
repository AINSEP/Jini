import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { flag, list, parseCliArgs, rejectUnknown, runIfMain, text } from "../lib/script-cli.mjs";
import { makeTempDir } from "./fakes-wc1.mjs";

describe("runIfMain", () => {
  const savedExitCode = process.exitCode;
  afterEach(() => {
    process.exitCode = savedExitCode;
  });

  it("runs main with the CLI args and records its exit code when the module is the entry script", async () => {
    const calls = [];
    const codes = [];
    const ran = await runIfMain(
      { moduleUrl: "file:///real/x.mjs", main: async (input) => { calls.push(input); return 2; } },
      { argv: ["node", "/link/x.mjs", "--a", "b"], realpath: (p) => p.replace("/link/", "/real/"), setExitCode: (c) => codes.push(c) },
    );
    expect(ran).toBe(true);
    expect(calls).toEqual([{ argv: ["--a", "b"] }]);
    expect(codes).toEqual([2]);
  });

  it("does nothing when imported by another module or with no script argument", async () => {
    const main = async () => { throw new Error("must not run"); };
    expect(await runIfMain({ moduleUrl: "file:///a.mjs", main }, { argv: ["node", "/b.mjs"], realpath: (p) => p })).toBe(false);
    expect(await runIfMain({ moduleUrl: "file:///a.mjs", main }, { argv: ["node"] })).toBe(false);
  });

  it("compares the path as given when it cannot be resolved", async () => {
    const ran = await runIfMain(
      { moduleUrl: pathToFileURL("/no/such/script").href, main: async () => 0 },
      { argv: ["node", "/no/such/script"], setExitCode: () => {} },
    );
    expect(ran).toBe(true);
  });

  it("resolves symlinks with the real fs and sets process.exitCode by default", async () => {
    const dir = makeTempDir();
    const real = path.join(dir, "real.mjs");
    fs.writeFileSync(real, "");
    fs.symlinkSync(real, path.join(dir, "link.mjs"));
    const ran = await runIfMain(
      { moduleUrl: pathToFileURL(fs.realpathSync(real)).href, main: async () => 3 },
      { argv: ["node", path.join(dir, "link.mjs")] },
    );
    expect(ran).toBe(true);
    expect(process.exitCode).toBe(3);
  });
});

describe("parseCliArgs", () => {
  const spec = {
    defaults: { name: "d", tags: [], on: false },
    flags: { "--name": { key: "name", read: text("fallback") }, "--tags": { key: "tags", read: list() }, "--on": flag("on") },
    onOther: (arg, out) => {
      out.rest = [...(out.rest || []), arg];
    },
  };

  it("applies value readers, switches and the onOther policy in argv order", () => {
    expect(parseCliArgs({ argv: ["x", "--name", "n", "--on", "--tags", "a, b,,", "y"], ...spec })).toEqual({
      name: "n", tags: ["a", "b"], on: true, rest: ["x", "y"],
    });
  });

  it("consumes the next entry even when it looks like a flag, and falls back on empty values", () => {
    expect(parseCliArgs({ argv: ["--name", "--on"], ...spec })).toEqual({ name: "--on", tags: [], on: false });
    expect(parseCliArgs({ argv: ["--name", ""], ...spec }).name).toBe("fallback");
    expect(parseCliArgs({ argv: ["--name"], ...spec }).name).toBe("fallback");
    expect(parseCliArgs({ argv: ["--tags"], ...spec }).tags).toEqual([]);
  });

  it("does not mutate the defaults and does not treat inherited keys as flags", () => {
    const out = parseCliArgs({ argv: ["toString"], ...spec });
    expect(out.rest).toEqual(["toString"]);
    expect(spec.defaults).toEqual({ name: "d", tags: [], on: false });
    expect(text()(undefined)).toBe("");
  });

  it("rejectUnknown throws the scripts' shared message", () => {
    expect(() => rejectUnknown("--x")).toThrow("Unexpected argument: --x");
  });
});
