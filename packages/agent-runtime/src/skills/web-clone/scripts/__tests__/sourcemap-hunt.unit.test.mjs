import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectScripts, fetchText, fileNameFor, main, parseArgs, resolveMapUrl } from "../sourcemap-hunt.mjs";
import { createOutput, tempDir } from "./fakes-wc2.mjs";

/** A fetch fake serving `routes` (url → body string, or a numeric status). */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init]);
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (typeof route === "string") return { ok: true, status: 200, statusText: "OK", text: async () => route };
    return { ok: false, status: route ?? 404, statusText: route ? "Server Error" : "Not Found", text: async () => "" };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

describe("argument parsing and helpers", () => {
  it("parses flags with defaults and rejects unknown ones", () => {
    expect(parseArgs(["--recon", "r.json", "--all-external", "--out"])).toEqual({ recon: "r.json", outDir: "RECON/sourcemaps", allExternal: true });
    expect(parseArgs(["-h"])).toMatchObject({ help: true, recon: "", allExternal: false });
    expect(() => parseArgs(["--deep"])).toThrow("Unexpected argument: --deep");
  });

  it("collectScripts dedupes absolute http(s) script URLs across captures", () => {
    const recon = {
      captures: [
        { signals: { scripts: ["https://s.test/a.js", "/rel.js", "HTTP://s.test/b.js"] } },
        { signals: { scripts: ["https://s.test/a.js"] } },
        { signals: {} },
        {},
      ],
    };
    expect(collectScripts(recon)).toEqual(["https://s.test/a.js", "HTTP://s.test/b.js"]);
    expect(collectScripts({})).toEqual([]);
  });

  it("fileNameFor sanitizes the basename, appends a hash and suffix, and falls back to bundle.js", () => {
    expect(fileNameFor("https://s.test/static/app@chunk.js.map", ".map")).toMatch(/^app-chunk\.js\.map-[0-9a-f]{10}\.map$/);
    expect(fileNameFor("https://s.test/")).toMatch(/^bundle\.js-[0-9a-f]{10}$/);
  });

  it("resolveMapUrl follows the hint, defaults to <script>.map, and skips data: maps", () => {
    expect(resolveMapUrl("https://s.test/js/a.js", "")).toBe("https://s.test/js/a.js.map");
    expect(resolveMapUrl("https://s.test/js/a.js", "a.js.map")).toBe("https://s.test/js/a.js.map");
    expect(resolveMapUrl("https://s.test/js/a.js", "/maps/a.map")).toBe("https://s.test/maps/a.map");
    expect(resolveMapUrl("https://s.test/js/a.js", "data:application/json;base64,e30=")).toBe("");
  });

  it("fetchText sends the skill user agent and throws on a non-ok status", async () => {
    const fetchImpl = fakeFetch({ "https://s.test/a.js": "code", "https://s.test/b.js": 503 });
    expect(await fetchText(fetchImpl, "https://s.test/a.js")).toBe("code");
    expect(fetchImpl.calls[0][1]).toEqual({ headers: { "user-agent": "web-clone-skill/1.0 sourcemap-hunt", accept: "*/*" } });
    await expect(fetchText(fetchImpl, "https://s.test/b.js")).rejects.toThrow("503 Server Error");
  });
});

describe("main", () => {
  it("prints usage: exit 0 for --help, 1 without --recon, 1 on a bad flag", async () => {
    const out = createOutput();
    expect(await main({ argv: ["--help"] }, out)).toBe(0);
    expect(await main({ argv: [] }, out)).toBe(1);
    expect(await main({ argv: ["--x"] }, out)).toBe(1);
    expect(out.logs[0]).toContain("node scripts/sourcemap-hunt.mjs --recon original-recon.json");
    expect(out.errors).toEqual(["sourcemap-hunt failed: Unexpected argument: --x"]);
  });

  it("downloads same-origin source maps and records each outcome", async () => {
    const dir = tempDir();
    const reconFile = path.join(dir, "original-recon.json");
    const scripts = [
      "https://s.test/js/app.js",
      "https://s.test/js/vendor.js",
      "https://s.test/js/inline.js",
      "https://s.test/js/missing.js",
      "https://s.test/js/nomap.js",
      "https://cdn.test/lib.js",
    ];
    fs.writeFileSync(reconFile, JSON.stringify({ url: "https://s.test/", captures: [{ signals: { scripts } }] }));
    const fetchImpl = fakeFetch({
      "https://s.test/js/app.js": "x();\n//# sourceMappingURL=app.js.map",
      "https://s.test/js/app.js.map": '{"version":3}',
      "https://s.test/js/vendor.js": "y();\n/*@ sourceMappingURL=/maps/vendor.map */",
      "https://s.test/maps/vendor.map": '{"version":3,"v":1}',
      "https://s.test/js/inline.js": "z();\n//# sourceMappingURL=data:application/json;base64,e30=",
      "https://s.test/js/missing.js": new Error("fetch failed"),
      "https://s.test/js/nomap.js": "w();",
    });
    const outDir = path.join(dir, "maps");
    const out = createOutput();
    expect(await main({ argv: ["--recon", reconFile, "--out", outDir] }, { ...out, fetch: fetchImpl })).toBe(0);

    const manifestFile = path.join(outDir, "sourcemap-manifest.json");
    expect(out.logs).toEqual([manifestFile]);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    expect(manifest).toMatchObject({ source: reconFile, url: "https://s.test/", allExternal: false, scriptCount: 5, mapCount: 2 });
    const byScript = Object.fromEntries(manifest.results.map((r) => [r.scriptUrl, r]));
    expect(byScript["https://s.test/js/app.js"]).toMatchObject({ status: "ok", mapUrl: "https://s.test/js/app.js.map", error: "" });
    expect(fs.readFileSync(byScript["https://s.test/js/app.js"].mapFile, "utf8")).toBe('{"version":3}');
    expect(byScript["https://s.test/js/vendor.js"]).toMatchObject({ status: "ok", mapUrl: "https://s.test/maps/vendor.map" });
    expect(byScript["https://s.test/js/inline.js"]).toMatchObject({ status: "inline-or-data-map", mapUrl: "", mapFile: "" });
    expect(byScript["https://s.test/js/missing.js"]).toMatchObject({ status: "error", error: "fetch failed" });
    expect(byScript["https://s.test/js/nomap.js"]).toMatchObject({ status: "error", mapUrl: "https://s.test/js/nomap.js.map", error: "404 Not Found" });
    expect(byScript["https://cdn.test/lib.js"]).toBeUndefined();
  });

  it("includes external scripts with --all-external, even without a recon url", async () => {
    const dir = tempDir();
    const reconFile = path.join(dir, "r.json");
    fs.writeFileSync(reconFile, JSON.stringify({ captures: [{ signals: { scripts: ["https://cdn.test/lib.js"] } }] }));
    const out = createOutput();
    const fetchImpl = fakeFetch({ "https://cdn.test/lib.js": "a()", "https://cdn.test/lib.js.map": "{}" });
    expect(await main({ argv: ["--recon", reconFile, "--out", dir, "--all-external"] }, { ...out, fetch: fetchImpl })).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "sourcemap-manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ allExternal: true, scriptCount: 1, mapCount: 1 });

    const none = createOutput();
    expect(await main({ argv: ["--recon", reconFile, "--out", dir] }, { ...none, fetch: fetchImpl })).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "sourcemap-manifest.json"), "utf8")).scriptCount).toBe(0);
  });

  it("fails with exit 1 when the recon file cannot be read", async () => {
    const out = createOutput();
    expect(await main({ argv: ["--recon", path.join(tempDir(), "nope.json")] }, out)).toBe(1);
    expect(out.errors[0]).toMatch(/^sourcemap-hunt failed: ENOENT/);
  });
});
