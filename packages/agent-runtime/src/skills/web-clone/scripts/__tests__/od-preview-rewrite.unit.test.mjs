import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main, parseArgs, rewriteSrcset, rootAssetPath, suffixFor, walk } from "../od-preview-rewrite.mjs";
import { createOutput, tempDir } from "./fakes-wc2.mjs";

function write(root, rel, content = "x") {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function makeProject() {
  const root = tempDir("wc2-rewrite-");
  for (const rel of ["assets/logo.png", "assets/hero.jpg", "fonts/a b.woff2", "data.json", "api/thing.png", "README", "%E0%A4%A.png"]) write(root, rel);
  return root;
}

describe("parseArgs", () => {
  it("defaults --project to the given cwd, including when the value is missing", () => {
    expect(parseArgs([], "/work")).toEqual({ project: "/work", help: false });
    expect(parseArgs(["--project"], "/work").project).toBe("/work");
    expect(parseArgs(["--project", "clone", "-h"], "/work")).toEqual({ project: "clone", help: true });
    expect(() => parseArgs(["x"], "/work")).toThrow("Unexpected argument: x");
  });
});

describe("rootAssetPath", () => {
  const root = makeProject();
  const project = { root, fs };

  it("resolves existing project-root asset references", () => {
    expect(rootAssetPath(project, " /assets/logo.png?v=1#x ")).toBe("assets/logo.png");
    expect(rootAssetPath(project, "/data.json")).toBe("data.json");
    expect(rootAssetPath(project, "/fonts/a%20b.woff2")).toBe("fonts/a b.woff2");
    expect(rootAssetPath(project, "/assets\\logo.png")).toBe("assets/logo.png");
  });

  it("keeps a malformed percent-encoding as-is", () => {
    expect(rootAssetPath(project, "/%E0%A4%A.png")).toBe("%E0%A4%A.png");
  });

  it("rejects relative, protocol-relative, bare-root, traversal, host-route, non-asset, and missing references", () => {
    for (const value of ["assets/logo.png", "//cdn.test/a.png", "/", "/?q", "/assets/../assets/logo.png", "/api/thing.png", "/README", "/%2Fassets/logo.png", "/assets/none.png"]) {
      expect(rootAssetPath(project, value)).toBeNull();
    }
  });
});

describe("helpers", () => {
  it("suffixFor returns the query/hash tail or an empty string", () => {
    expect(suffixFor("/a.png?v=1#h")).toBe("?v=1#h");
    expect(suffixFor("/a.png")).toBe("");
  });

  it("rewriteSrcset rewrites each candidate, keeping descriptors, spacing, and empty slots", () => {
    const root = makeProject();
    const owner = path.join(root, "pages", "index.html");
    expect(rewriteSrcset({ root, fs }, owner, "/assets/logo.png 1x,  /assets/hero.jpg 2x , , /missing.png 3x")).toBe(
      "../assets/logo.png 1x,  ../assets/hero.jpg 2x , , /missing.png 3x",
    );
  });

  it("walk collects html/htm/css/svg files and skips build/vendor directories", () => {
    const root = tempDir();
    for (const rel of ["a.html", "b.HTM", "c.css", "d.svg", "e.txt", "sub/f.html", "node_modules/p/g.html", "RECON/h.html", ".git/i.html", "dist/j.css"]) write(root, rel);
    const found = walk(fs, root).map((file) => path.relative(root, file)).sort();
    expect(found).toEqual(["a.html", "b.HTM", "c.css", "d.svg", path.join("sub", "f.html")]);
  });
});

describe("main", () => {
  it("prints usage for --help and reports bad arguments as exit 1", async () => {
    const out = createOutput();
    expect(await main(["--help"], out)).toBe(0);
    expect(out.logs[0]).toContain("node scripts/od-preview-rewrite.mjs [--project <clone-dir>]");
    expect(await main(["--bogus"], out)).toBe(1);
    expect(out.errors).toEqual(["od-preview-rewrite failed: Unexpected argument: --bogus"]);
  });

  it("rewrites root asset references in HTML, CSS, and SVG relative to each file", async () => {
    const root = makeProject();
    write(root, "index.html", '<img src="/assets/logo.png"><a href="/about">x</a>');
    write(
      root,
      "pages/about/index.html",
      [
        '<img src="/assets/logo.png?v=2#frag">',
        '<img src="//cdn.test/x.png">',
        '<img srcset="/assets/logo.png 1x, /assets/hero.jpg 2x">',
        '<img srcset="https://cdn.test/x.png 1x">',
        "<video poster='/assets/hero.jpg'></video>",
        '<div style="background:url(/assets/hero.jpg)"></div>',
        '<link href="/fonts/a%20b.woff2">',
        '<img src="/%E0%A4%A.png">',
        '<img src="/api/thing.png">',
      ].join("\n"),
    );
    write(root, "styles/site.css", "a{background:url('/fonts/a%20b.woff2')} b{background:url( \"/assets/logo.png\" )} c{background:url(/nope.png)}");
    write(root, "styles/plain.css", "a{color:red}");
    write(root, "icon.svg", '<svg><image href="/assets/logo.png"/></svg>');
    write(root, "node_modules/pkg/index.html", '<img src="/assets/logo.png">');
    const out = createOutput();

    expect(await main(["--project", root], out)).toBe(0);

    expect(out.logs.at(-1)).toBe("od-preview-rewrite: 4 file(s) updated");
    expect(out.logs.slice(0, -1).sort()).toEqual(["icon.svg", "index.html", "pages/about/index.html", "styles/site.css"]);
    expect(fs.readFileSync(path.join(root, "index.html"), "utf8")).toBe('<img src="./assets/logo.png"><a href="/about">x</a>');
    expect(fs.readFileSync(path.join(root, "pages/about/index.html"), "utf8").split("\n")).toEqual([
      '<img src="../../assets/logo.png?v=2#frag">',
      '<img src="//cdn.test/x.png">',
      '<img srcset="../../assets/logo.png 1x, ../../assets/hero.jpg 2x">',
      '<img srcset="https://cdn.test/x.png 1x">',
      "<video poster='../../assets/hero.jpg'></video>",
      '<div style="background:url(../../assets/hero.jpg)"></div>',
      '<link href="../../fonts/a b.woff2">',
      '<img src="../../%E0%A4%A.png">',
      '<img src="/api/thing.png">',
    ]);
    expect(fs.readFileSync(path.join(root, "styles/site.css"), "utf8")).toBe(
      "a{background:url('../fonts/a b.woff2')} b{background:url(\"../assets/logo.png\")} c{background:url(/nope.png)}",
    );
    expect(fs.readFileSync(path.join(root, "styles/plain.css"), "utf8")).toBe("a{color:red}");
    expect(fs.readFileSync(path.join(root, "icon.svg"), "utf8")).toBe('<svg><image href="./assets/logo.png"/></svg>');
    expect(fs.readFileSync(path.join(root, "node_modules/pkg/index.html"), "utf8")).toBe('<img src="/assets/logo.png">');
  });

  it("defaults to the current working directory port and is idempotent", async () => {
    const root = makeProject();
    write(root, "index.html", '<img src="/assets/logo.png">');
    const out = createOutput();
    expect(await main([], { ...out, cwd: () => root })).toBe(0);
    expect(await main([], { ...out, cwd: () => root })).toBe(0);
    expect(out.logs).toEqual(["index.html", "od-preview-rewrite: 1 file(s) updated", "od-preview-rewrite: 0 file(s) updated"]);
  });

  it("fails with exit 1 when the project directory does not exist", async () => {
    const out = createOutput();
    expect(await main(["--project", path.join(tempDir(), "missing")], out)).toBe(1);
    expect(out.errors[0]).toMatch(/^od-preview-rewrite failed: ENOENT/);
  });
});
