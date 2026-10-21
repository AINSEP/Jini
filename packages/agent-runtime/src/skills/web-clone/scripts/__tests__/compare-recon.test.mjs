import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inferComplexity,
  interactionSection,
  main,
  parseArgs,
  ratioScore,
  report,
  routesSection,
  score,
  sequenceSimilarity,
} from "../compare-recon.mjs";
import { makeIo, makeTempDir } from "./fakes-wc1.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

const recon = (signals, extra = {}) => ({ captures: [{ signals, screenshot: "s.png" }], ...extra });

describe("parseArgs", () => {
  it("defaults every input to empty and the report to CLONE_REPORT.md", () => {
    expect(parseArgs([])).toEqual({
      original: "", clone: "", visualDiff: "", originalRoutes: "", cloneRoutes: "",
      originalInteractions: "", cloneInteractions: "", out: "CLONE_REPORT.md",
    });
  });

  it("maps every flag to its key", () => {
    expect(parseArgs([
      "--original", "o", "--clone", "c", "--visual-diff", "v", "--original-routes", "or", "--clone-routes", "cr",
      "--original-interactions", "oi", "--clone-interactions", "ci", "--out", "r.md", "-h",
    ])).toEqual({
      original: "o", clone: "c", visualDiff: "v", originalRoutes: "or", cloneRoutes: "cr",
      originalInteractions: "oi", cloneInteractions: "ci", out: "r.md", help: true,
    });
    expect(parseArgs(["--out"]).out).toBe("CLONE_REPORT.md");
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(() => parseArgs(["o.json"])).toThrow("Unexpected argument: o.json");
  });
});

describe("ratioScore", () => {
  it("scores closeness of two counts on a 1..5 scale", () => {
    expect(ratioScore(0, 0)).toBe(5);
    expect(ratioScore(0, 3)).toBe(1);
    expect(ratioScore(4, 0)).toBe(1);
    expect(ratioScore(100, 95)).toBe(5);
    expect(ratioScore(80, 100)).toBe(4);
    expect(ratioScore(60, 100)).toBe(3);
    expect(ratioScore(100, 40)).toBe(2);
    expect(ratioScore(30, 100)).toBe(1);
  });
});

describe("sequenceSimilarity", () => {
  it("is the share of tag:text keys present on both sides", () => {
    const h = (tag, text) => ({ tag, text });
    expect(sequenceSimilarity([], [])).toBe(1);
    expect(sequenceSimilarity([h("h1", "A")], [])).toBe(0);
    expect(sequenceSimilarity([], [h("h1", "A")])).toBe(0);
    expect(sequenceSimilarity([h("h1", "A"), h("h2", "B")], [h("h1", "A"), h("h2", "C"), h("h2", "D")])).toBeCloseTo(1 / 3);
  });
});

describe("inferComplexity", () => {
  it("picks the most demanding matching level", () => {
    expect(inferComplexity({ counts: { forms: 3, inputs: 11, canvas: 1 } })).toBe("L6");
    expect(inferComplexity({ counts: { forms: 3, inputs: 10, canvas: 1 } })).toBe("L5");
    expect(inferComplexity({ frameworks: { three: true } })).toBe("L5");
    expect(inferComplexity({ frameworks: { gsap: true } })).toBe("L4");
    expect(inferComplexity({ frameworks: { lenis: true } })).toBe("L4");
    expect(inferComplexity({ counts: { video: 3 } })).toBe("L4");
    expect(inferComplexity({ frameworks: { next: true, jquery: true } })).toBe("L3");
    expect(inferComplexity({ frameworks: { jquery: true, react: false }, counts: { links: 81 } })).toBe("L2");
    expect(inferComplexity({ counts: { images: 41 } })).toBe("L2");
    expect(inferComplexity({})).toBe("L1");
  });
});

describe("score", () => {
  it("derives structure, interaction, responsive and functional scores from the first capture", () => {
    const original = { captures: [{ signals: { headings: [{ tag: "h1", text: "A" }], counts: { links: 10, forms: 1, buttons: 2, inputs: 2, canvas: 1 } } }, {}] };
    const clone = { captures: [{ signals: { headings: [{ tag: "h1", text: "B" }], counts: { links: 10, forms: 1, buttons: 2, inputs: 2 } } }] };
    expect(score(original, clone, null)).toEqual({
      sourceEvidence: 3,
      structure: 1,
      visual: "需人工看截图或传 --visual-diff",
      interaction: 3,
      responsive: 2,
      functional: 5,
      contentReplacement: "需人工看文案残留",
      legalRisk: "需人工核查 license / 素材",
    });
    const same = score(original, original, { visualScore: 4 });
    expect(same).toMatchObject({ structure: 5, visual: "4/5", interaction: 5, responsive: 4 });
    expect(score({}, {}, null)).toMatchObject({ structure: 5, responsive: 4, functional: 5 });
  });
});

describe("routesSection", () => {
  it("asks for route maps when either side is missing", () => {
    expect(routesSection({}, { originalRoutes: { routes: [] }, cloneRoutes: null })).toContain("未提供 route-crawl 结果");
  });

  it("compares path+query across hosts and lists missing/extra routes", () => {
    // "x:" has an empty path and query, so it counts as "/"; unparseable URLs are compared verbatim.
    const section = routesSection(
      { originalRoutes: "o.json", cloneRoutes: "c.json" },
      {
        originalRoutes: { routes: [{ url: "https://o.test/" }, { url: "https://o.test/a?x=1" }, { url: "not a url" }, { url: "x:" }] },
        cloneRoutes: { routes: [{ url: "http://localhost:8123/" }, { url: "http://localhost:8123/b" }] },
      },
    );
    expect(section).toBe(`## 路由覆盖
- 原站路由: 3
- 克隆路由: 2
- 覆盖率: 33%
- 原站 route map: o.json
- 克隆 route map: c.json
- 缺失路由: /a?x=1, not a url
- 额外路由: /b
`);
  });

  it("reports full coverage and 无 when nothing differs or nothing was crawled", () => {
    const section = routesSection({}, { originalRoutes: {}, cloneRoutes: {} });
    expect(section).toContain("- 覆盖率: 100%\n");
    expect(section).toContain("- 缺失路由: 无\n- 额外路由: 无\n");
  });
});

describe("interactionSection", () => {
  it("asks for probes when either side is missing", () => {
    expect(interactionSection({}, { originalInteractions: null, cloneInteractions: {} })).toContain("未提供 interaction-probe 结果");
  });

  it("compares changed actions and canvas targets", () => {
    const files = { originalInteractions: "oi.json", cloneInteractions: "ci.json" };
    const probe = { actions: [{ changed: true }, { changed: false }], discovered: { canvases: [1], interactive: [1, 2, 3] } };
    const close = interactionSection(files, { originalInteractions: probe, cloneInteractions: probe });
    expect(close).toContain("- 原站可见交互目标: 3\n- 克隆可见交互目标: 3\n- 原站 canvas 目标: 1\n");
    expect(close).toContain("- 原站 changed actions: 1/2\n");
    expect(close).toContain("- 原站 interaction probe: oi.json\n- 克隆 interaction probe: ci.json\n");
    expect(close).toContain("交互数量信号接近");
    const sparse = interactionSection(files, { originalInteractions: probe, cloneInteractions: { actions: [{ changed: true }] } });
    expect(sparse).toContain("- 克隆 canvas 目标: 0\n");
    expect(sparse).toContain("交互数量信号不一致");
    expect(interactionSection(files, { originalInteractions: probe, cloneInteractions: {} })).toContain("- 克隆 changed actions: 0/0\n");
  });
});

describe("report", () => {
  const noEvidence = { visualDiff: null, originalRoutes: null, cloneRoutes: null, originalInteractions: null, cloneInteractions: null };

  it("renders labels, complexity-based mode, tech signals, count table, console and screenshot evidence", () => {
    const original = recon(
      { title: "Orig", lang: "ja", frameworks: { three: true, gsap: false }, scrollHeight: 4200, h1: ["Hello", "World"], counts: { links: 20, canvas: 2 } },
      { label: "nike", url: "https://o.test/", console: { errors: [1], pageErrors: [1, 2] } },
    );
    const clone = recon({ h1: [], counts: { links: 20 } }, { url: "http://localhost/" });
    const md = report({ original: "o.json", clone: "c.json", visualDiff: "v.json" }, original, clone, { ...noEvidence, visualDiff: { visualScore: 3, diffPixelRatio: 0.2 } });
    expect(md.startsWith("# nike vs clone · 克隆评估报告\n")).toBe(true);
    expect(md).toContain("- 自动推断复杂度: L5\n- 复刻模式建议: 技术拆解 / 忠实复刻优先\n");
    expect(md).toContain("| title | Orig |  |\n| lang | ja |  |\n| frameworks | three | none |\n| scrollHeight | 4200 | 0 |\n| h1 | Hello, World | none |");
    expect(md).toContain("| links | 20 | 20 | 5/5 |\n");
    expect(md).toContain("| canvas | 2 | 0 | 1/5 |\n");
    expect(md).toContain("- 视觉保真: 3/5\n");
    expect(md).toContain("- 原站 console errors: 1\n- 克隆 console errors: 0\n- 原站 page errors: 2\n- 克隆 page errors: 0\n");
    expect(md).toContain("- 像素差异: v.json\n- 像素差异率: 0.2\n- 原站截图: s.png\n- 克隆截图: s.png\n");
  });

  it("falls back to default labels, the L6 and generic modes, and 未提供 evidence", () => {
    const l6 = recon({ counts: { forms: 3, inputs: 11 } }, { label: "", url: "u" });
    const md = report({ original: "o", clone: "c" }, l6, { url: "v" }, noEvidence);
    expect(md.startsWith("# original vs clone · 克隆评估报告\n")).toBe(true);
    expect(md).toContain("- 复刻模式建议: 展示层视觉复刻\n");
    expect(md).toContain("| h1 |  |  |");
    expect(md).toContain("- 像素差异: 未提供\n- 像素差异率: 未提供\n- 原站截图: s.png\n- 克隆截图: \n");
    expect(report({}, recon({}), recon({}), noEvidence)).toContain("- 复刻模式建议: 视觉复刻 / 内容爆改\n");
  });
});

describe("main", () => {
  function workspace() {
    const dir = makeTempDir("wc1-compare-");
    fs.writeFileSync(path.join(dir, "o.json"), JSON.stringify(recon({ counts: { links: 3 } }, { url: "https://o.test/" })));
    fs.writeFileSync(path.join(dir, "c.json"), JSON.stringify(recon({ counts: { links: 3 } }, { url: "http://localhost/" })));
    fs.writeFileSync(path.join(dir, "v.json"), JSON.stringify({ visualScore: 5, diffPixelRatio: 0.01 }));
    fs.writeFileSync(path.join(dir, "routes.json"), JSON.stringify({ routes: [{ url: "https://o.test/" }] }));
    return dir;
  }

  it("prints usage: exit 0 for --help, 1 when --original or --clone is missing", () => {
    const { io, out } = makeIo("/");
    expect(main({ argv: ["--help"] }, io)).toBe(0);
    expect(main({ argv: ["--original", "o.json"] }, io)).toBe(1);
    expect(main({ argv: ["--clone", "c.json"] }, io)).toBe(1);
    expect(out.logs).toHaveLength(3);
    expect(out.logs[0]).toContain("node scripts/compare-recon.mjs --original <original-recon.json>");
  });

  it("reads inputs relative to the cwd, writes the report and prints its path", () => {
    const dir = workspace();
    const { io, out } = makeIo(dir);
    const argv = ["--original", "o.json", "--clone", "c.json", "--visual-diff", "v.json", "--original-routes", "routes.json", "--clone-routes", "routes.json", "--out", "out/REPORT.md"];
    expect(main({ argv }, io)).toBe(0);
    const file = path.join(dir, "out", "REPORT.md");
    expect(out.logs).toEqual([file]);
    const md = fs.readFileSync(file, "utf8");
    expect(md).toContain("- 原站 URL: https://o.test/\n- 克隆 URL: http://localhost/\n");
    expect(md).toContain("- 视觉保真: 5/5\n");
    expect(md).toContain("- 覆盖率: 100%\n- 原站 route map: routes.json\n");
    expect(md).toContain("未提供 interaction-probe 结果");
  });

  it("exits 1 with a message when an input cannot be read or a flag is unknown", () => {
    const dir = workspace();
    const { io, out } = makeIo(dir);
    expect(main({ argv: ["--original", "o.json", "--clone", "missing.json"] }, io)).toBe(1);
    expect(main({ argv: ["--bogus"] }, io)).toBe(1);
    expect(out.errors[0]).toMatch(/^compare-recon failed: ENOENT/);
    expect(out.errors[1]).toBe("compare-recon failed: Unexpected argument: --bogus");
  });

  it("uses the real fs and console when no ports are injected", () => {
    const dir = workspace();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const file = path.join(dir, "R.md");
    expect(main({ argv: ["--original", path.join(dir, "o.json"), "--clone", path.join(dir, "c.json"), "--out", file] })).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toContain("· 克隆评估报告");
  });
});
