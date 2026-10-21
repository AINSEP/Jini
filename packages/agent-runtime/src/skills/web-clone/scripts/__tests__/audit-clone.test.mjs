import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChecks,
  collectMatches,
  customFontFamilies,
  fidelityFindings,
  main,
  markdown,
  normalizeColor,
  parseArgs,
  walk,
} from "../audit-clone.mjs";
import { makeIo, makeTempDir } from "./fakes-wc1.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Writes `tree` ({ "rel/path": contents }) under a fresh temp dir. */
function project(tree) {
  const dir = makeTempDir("wc1-audit-");
  for (const [rel, body] of Object.entries(tree)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

const recon = (signals) => ({ captures: [{ signals }] });

describe("parseArgs", () => {
  it("defaults to the cwd project and CLONE_AUDIT.md", () => {
    expect(parseArgs([])).toEqual({ project: ".", brand: [], out: "CLONE_AUDIT.md", recon: "", strict: false });
  });

  it("reads all flags, splitting --brand on commas", () => {
    expect(parseArgs(["--project", "p", "--brand", "KOKUYO, Acme ,", "--out", "o.md", "--recon", "r.json", "--strict", "-h"])).toEqual({
      project: "p", brand: ["KOKUYO", "Acme"], out: "o.md", recon: "r.json", strict: true, help: true,
    });
    expect(parseArgs(["--project", "--out"]).project).toBe("--out");
    expect(parseArgs(["--out"]).out).toBe("CLONE_AUDIT.md");
    expect(parseArgs(["--project"]).project).toBe(".");
    expect(parseArgs(["--help"]).help).toBe(true);
  });

  it("rejects stray arguments", () => {
    expect(() => parseArgs(["clone-dir"])).toThrow("Unexpected argument: clone-dir");
  });
});

describe("normalizeColor", () => {
  it("normalizes rgb/rgba/#rgb/#rrggbb to r,g,b", () => {
    expect(normalizeColor("rgb(1, 2, 3)")).toBe("1,2,3");
    expect(normalizeColor(" RGBA(10,20,30,0.5) ")).toBe("10,20,30");
    expect(normalizeColor("#0aF")).toBe("0,170,255");
    expect(normalizeColor("#102030ff")).toBe("16,32,48");
  });

  it("returns null for transparent and unparseable values", () => {
    expect(normalizeColor("rgba(0, 0, 0, 0)")).toBeNull();
    expect(normalizeColor("transparent")).toBeNull();
    expect(normalizeColor(undefined)).toBeNull();
  });
});

describe("customFontFamilies", () => {
  it("merges declared @font-face families with non-generic used families, deduped", () => {
    expect(customFontFamilies(recon({
      fontFaces: [{ family: " Brand Sans " }, {}],
      fonts: ['"Brand Sans"', "Arial", "'Display X'", "", "serif"],
    }))).toEqual(["Brand Sans", "Display X"]);
    expect(customFontFamilies(null)).toEqual([]);
    expect(customFontFamilies(recon({}))).toEqual([]);
  });
});

describe("fidelityFindings", () => {
  const labels = (findings) => findings.map((f) => f.label);

  it("flags custom fonts with no local font files", () => {
    const dir = project({ "index.html": "<p>x</p>" });
    const findings = fidelityFindings(recon({ fonts: ["Brand"] }), dir, [path.join(dir, "index.html")]);
    expect(findings).toEqual([{
      type: "fidelity", label: "fonts not self-hosted", file: dir, line: 0,
      match: "original uses custom fonts (Brand) but the clone ships no local font files — run asset-harvest and link fonts/fonts.css",
    }]);
  });

  it("flags downloaded fonts no @font-face uses, and passes when one does", () => {
    const dir = project({ "a.woff2": "", "s.css": "body{}", "x.js": "@font-face" });
    const files = ["a.woff2", "s.css", "x.js"].map((f) => path.join(dir, f));
    expect(labels(fidelityFindings(recon({ fonts: ["Brand"] }), dir, files))).toEqual(["fonts downloaded but unused"]);
    fs.writeFileSync(path.join(dir, "s.css"), "@font-face{font-family:Brand}");
    expect(fidelityFindings(recon({ fonts: ["Brand"] }), dir, files)).toEqual([]);
  });

  it("requires local images only when the original loaded at least three", () => {
    expect(labels(fidelityFindings(recon({ resources: { images: [1, 2, 3] } }), "/p", []))).toEqual(["images not harvested"]);
    expect(labels(fidelityFindings(recon({ images: [1, 2, 3] }), "/p", ["/p/a.webp"]))).toEqual([]);
    expect(labels(fidelityFindings(recon({ images: [1, 2] }), "/p", []))).toEqual([]);
  });

  it("requires each opaque body/header/footer color verbatim in clone css/html", () => {
    const dir = project({ "s.css": "body{background:#fff;color:rgb(17, 17, 17)}", "a.js": "#ff0000" });
    const files = ["s.css", "a.js"].map((f) => path.join(dir, f));
    const findings = fidelityFindings(recon({
      palette: {
        body: { backgroundColor: "rgb(255, 255, 255)", color: "#111" },
        header: { backgroundColor: "rgba(0, 0, 0, 0)", color: "rgb(255, 0, 0)" },
      },
    }), dir, files);
    expect(findings).toEqual([{
      type: "fidelity", label: "palette mismatch: header color", file: dir, line: 0,
      match: "original computed rgb(255, 0, 0) (rgb 255,0,0) not found anywhere in clone css/html — copy the exact value from recon, do not eyeball",
    }]);
  });
});

describe("walk", () => {
  it("lists scannable text files, skipping build dirs, screenshots, notes and binaries", () => {
    const dir = project({
      "index.html": "", "src/app.TS": "", "NOTES.md": "", "logo.png": "", "node_modules/x.js": "",
      "RECON/r.json": "", "screenshots/s.svg": "", "nested/screenshots/t.svg": "", "nested/ok.md": "",
    });
    expect(walk(dir).map((f) => path.relative(dir, f)).sort()).toEqual(["index.html", "nested/ok.md", "src/app.TS"]);
  });
});

describe("collectMatches", () => {
  it("reports each match with type, label, 1-based line and a 160-char excerpt, ignoring w3.org", () => {
    const text = `ok\n<script src="https://www.googletagmanager.com/gtm.js?id=GTM-AB12"></script>\n<svg xmlns="http://www.w3.org/2000/svg">\n${"x".repeat(5)}`;
    const findings = collectMatches("/p/i.html", text, buildChecks([]));
    expect(findings.map((f) => [f.type, f.label, f.line, f.match])).toEqual([
      ["tracking", "Google Tag Manager", 2, "googletagmanager"],
      ["tracking", "Google Tag Manager", 2, "GTM-AB12"],
      ["external", "external URL", 2, "https://www.googletagmanager.com/gtm.js?id=GTM-AB12"],
    ]);
    const long = collectMatches("/p/a", `https://e.test/${"a".repeat(300)}`, buildChecks([]));
    expect(long[0].match).toHaveLength(160);
  });

  it("escapes brand names into literal case-insensitive patterns and honours explicit flags", () => {
    const checks = buildChecks(["A.B (Co)"]);
    expect(checks.at(-1)).toEqual({ type: "brand", label: "brand residue: A.B (Co)", pattern: "A\\.B \\(Co\\)", flags: "gi" });
    expect(collectMatches("/f", "a.b (co) and AxB (Co)", checks).map((f) => f.match)).toEqual(["a.b (co)"]);
    expect(collectMatches("/f", "カタカナ", checks).map((f) => f.type)).toEqual(["japanese"]);
    expect(collectMatches("/f", "todo TODO", [{ type: "todo", label: "t", pattern: "TODO" }])).toHaveLength(2);
  });
});

describe("markdown", () => {
  it("renders every section, empty ones as 未发现, and the clean conclusion", () => {
    const md = markdown([], "/p", 4);
    expect(md).toContain("# Clone Audit\n\n- Project: /p\n- Scanned files: 4\n- Findings: 0\n");
    expect(md.match(/- 未发现\n/g)).toHaveLength(6);
    expect(md.endsWith("## 结论\n- 未发现明显残留项；仍需人工核查素材授权和视觉截图。\n")).toBe(true);
  });

  it("lists findings relative to the project, escapes backticks and truncates past 200", () => {
    const many = Array.from({ length: 202 }, (_, i) => ({ type: "todo", label: "TODO", file: "/p/src/a.js", line: i + 1, match: "a`b" }));
    const md = markdown(many, "/p", 1);
    expect(md).toContain("## TODO / 占位内容\n- src/a.js:1 · TODO · `a'b`\n");
    expect(md).toContain("- 还有 2 条未展开\n");
    expect(md).not.toContain("src/a.js:201 ");
    expect(md).toContain("- 需要处理上面的残留项后再声明可部署。");
  });
});

describe("main", () => {
  it("prints usage for --help and exits 0", () => {
    const { io, out } = makeIo("/");
    expect(main({ argv: ["--help"] }, io)).toBe(0);
    expect(out.logs[0]).toContain("node scripts/audit-clone.mjs --project <clone-dir>");
  });

  it("audits the project into the output file and prints its path", () => {
    const dir = project({ "clone/index.html": "<!-- TODO hero --><p>KOKUYO</p>" });
    const { io, out } = makeIo(dir);
    expect(main({ argv: ["--project", "clone", "--brand", "kokuyo", "--out", "reports/AUDIT.md"] }, io)).toBe(0);
    const report = path.join(dir, "reports", "AUDIT.md");
    expect(out.logs).toEqual([report]);
    const md = fs.readFileSync(report, "utf8");
    expect(md).toContain("- Scanned files: 1\n- Findings: 2\n");
    expect(md).toContain("- index.html:1 · brand residue: kokuyo · `KOKUYO`");
    expect(md).toContain("- index.html:1 · TODO / placeholder content · `TODO`");
    expect(out.errors).toEqual([]);
  });

  it("puts fidelity findings first, reports them on stderr, and exits 2 only with --strict", () => {
    const dir = project({
      "site/index.html": "<p>hi</p>",
      "site/fonts/brand.woff2": "",
      "site/node_modules/pkg/hero.png": "",
      "r.json": JSON.stringify(recon({ fonts: ["Brand"], images: [1, 2, 3] })),
    });
    const { io, out } = makeIo(dir);
    expect(main({ argv: ["--project", "site", "--recon", "r.json"] }, io)).toBe(0);
    expect(out.errors).toEqual([
      "⚠️ 2 个保真度硬伤（详见 CLONE_AUDIT.md）：",
      "   - fonts downloaded but unused: local font files exist but no @font-face references them (Brand)",
      "   - images not harvested: original loaded 3 images but the clone ships zero local image files — placeholders/gradients are not a clone",
    ]);
    const md = fs.readFileSync(path.join(dir, "CLONE_AUDIT.md"), "utf8");
    expect(md).toContain("- Findings: 2\n");
    expect(md).toContain("- :0 · fonts downloaded but unused · ");
    expect(main({ argv: ["--project", "site", "--recon", "r.json", "--strict"] }, io)).toBe(2);
  });

  it("passes the fidelity gates silently when the clone matches the recon", () => {
    const dir = project({ "site/s.css": "body{color:#000}", "r.json": JSON.stringify(recon({ palette: { body: { color: "rgb(0, 0, 0)" } } })) });
    const { io, out } = makeIo(dir);
    expect(main({ argv: ["--project", "site", "--recon", "r.json", "--strict"] }, io)).toBe(0);
    expect(out.errors).toEqual([]);
  });

  it("exits 1 with a message for a missing project, bad recon or bad flag", () => {
    const dir = project({ "bad.json": "{" });
    const { io, out } = makeIo(dir);
    expect(main({ argv: ["--project", "missing"] }, io)).toBe(1);
    expect(main({ argv: ["--recon", "bad.json"] }, io)).toBe(1);
    expect(main({ argv: ["--nope"] }, io)).toBe(1);
    expect(out.errors[0]).toBe(`audit-clone failed: Project not found: ${path.join(dir, "missing")}`);
    expect(out.errors[1]).toMatch(/^audit-clone failed: .*JSON/);
    expect(out.errors[2]).toBe("audit-clone failed: Unexpected argument: --nope");
  });

  it("uses the real fs and console when no ports are injected", () => {
    const dir = project({ "index.html": "plain" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const report = path.join(dir, "out.md");
    expect(main({ argv: ["--project", dir, "--out", report] })).toBe(0);
    expect(fs.readFileSync(report, "utf8")).toContain("- Findings: 0\n");
  });
});
