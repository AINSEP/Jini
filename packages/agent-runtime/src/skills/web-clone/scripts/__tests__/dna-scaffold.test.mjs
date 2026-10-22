import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enrich, flattenRecon, main, parseArgs, skeleton } from "../dna-scaffold.mjs";
import { makeIo, makeTempDir } from "./fakes-wc1.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

describe("parseArgs", () => {
  it("reads --recon/--out/--name/--help and ignores anything else", () => {
    expect(parseArgs([])).toEqual({ recon: "", out: "", name: "", help: false });
    expect(parseArgs(["extra", "--recon", "r.json", "--weird", "--out", "d.json", "--name", "Nike", "-h"])).toEqual({
      recon: "r.json", out: "d.json", name: "Nike", help: true,
    });
    expect(parseArgs(["--help", "--out"])).toEqual({ recon: "", out: "", name: "", help: true });
  });
});

describe("skeleton", () => {
  it("is the full empty DNA with independent type-scale entries and the given name", () => {
    const dna = skeleton("Acme");
    expect(dna.meta).toEqual({ name: "Acme", description: "", source_references: "", created_at: "" });
    expect(Object.keys(dna)).toEqual(["meta", "design_system", "design_style", "visual_effects"]);
    expect(dna.design_system.typography.type_scale.body).toEqual({ size: "", weight: "", line_height: "", tracking: "" });
    dna.design_system.typography.type_scale.body.size = "16px";
    expect(dna.design_system.typography.type_scale.caption.size).toBe("");
    expect(skeleton().meta.name).toBe("");
    expect(skeleton().visual_effects["3d_elements"].enabled).toBe(false);
  });
});

describe("flattenRecon", () => {
  it("uses the widest viewport's signals and carries the top-level url as href", () => {
    const flat = flattenRecon({
      url: "https://o.test/",
      captures: [
        { viewport: { width: 390 }, signals: { title: "mobile" } },
        { signals: { title: "no viewport" } },
        { viewport: { width: 1440 }, signals: { title: "desktop", href: "https://override.test/" } },
        null,
        { viewport: { width: 9999 } },
      ],
    });
    expect(flat).toEqual({ href: "https://override.test/", title: "desktop" });
    expect(flattenRecon({ url: "u", captures: [{ signals: { a: 1 } }] })).toEqual({ href: "u", a: 1 });
  });

  it("returns already-flat or signal-less input unchanged", () => {
    const flat = { fonts: ["A"] };
    expect(flattenRecon(flat)).toBe(flat);
    const empty = { captures: [] };
    expect(flattenRecon(empty)).toBe(empty);
    const noSignals = { captures: [{ viewport: { width: 1 } }] };
    expect(flattenRecon(noSignals)).toBe(noSignals);
    expect(flattenRecon(null)).toBeNull();
  });
});

describe("enrich", () => {
  it("prefills fonts (heading/body/mono), colors, surface background and meta from real signals", () => {
    const dna = enrich(skeleton(""), {
      href: "https://o.test/",
      title: "Site",
      fonts: ["Brand Sans, sans-serif", "JetBrains Mono", "Brand Sans"],
      sections: [
        { style: { fontFamily: '"Serif X"', backgroundColor: "rgba(0, 0, 0, 0)", color: "#111" } },
        { style: { backgroundColor: "transparent" } },
        { style: { backgroundColor: "rgb(250, 250, 250)", color: "#111" } },
        null,
      ],
      cssVariables: [["--brand", " #ff0000 "], { name: "--gap", value: "8px" }, { name: "--bg", value: "hsl(0 0% 100%)" }, null, ["--rgb", "rgba(1,2,3,.5)"]],
    });
    expect(dna.design_system.typography.font_families).toEqual({ heading: "Brand Sans", body: "Serif X", mono: "JetBrains Mono" });
    expect(dna.design_system.color.surface.background).toBe("rgb(250, 250, 250)");
    expect(dna.meta.source_references).toBe("https://o.test/");
    expect(dna.meta.name).toBe("Site");
    expect(dna._recon_signals).toEqual({
      fonts: ["Brand Sans", "JetBrains Mono", "Serif X"],
      color_candidates: ["#ff0000", "hsl(0 0% 100%)", "rgba(1,2,3,.5)", "#111", "rgb(250, 250, 250)"],
      frameworks: {},
      canvas_count: 0,
      css_color_vars: ["--brand: #ff0000", "--bg: hsl(0 0% 100%)", "--rgb: rgba(1,2,3,.5)"],
    });
    expect(dna._scaffold_note).toMatch(/^best-effort 预填来自 recon。/);
  });

  it("uses one non-mono font for both heading and body, and keeps an explicit name", () => {
    const dna = enrich(skeleton("Mine"), { fonts: ["Only"], title: "Ignored" });
    expect(dna.design_system.typography.font_families).toEqual({ heading: "Only", body: "Only", mono: "" });
    expect(dna.meta.name).toBe("Mine");
    const monoOnly = enrich(skeleton(""), { fonts: ["Courier Prime"] });
    expect(monoOnly.design_system.typography.font_families).toEqual({ heading: "", body: "", mono: "Courier Prime" });
  });

  it("leaves fields empty when the recon has no usable signals, keeping at most 24 color candidates", () => {
    const sections = Array.from({ length: 30 }, (_, i) => ({ style: { color: `#${String(i).padStart(6, "0")}` } }));
    const dna = enrich(skeleton(""), { fonts: "not-an-array", cssVariables: {}, sections });
    expect(dna.design_system.typography.font_families).toEqual({ heading: "", body: "", mono: "" });
    expect(dna.design_system.color.surface.background).toBe("");
    expect(dna.meta).toMatchObject({ name: "", source_references: "" });
    expect(dna._recon_signals.color_candidates).toHaveLength(24);
  });

  it("maps three / canvas / gsap / lenis signals onto visual_effects", () => {
    const three = enrich(skeleton(""), { frameworks: { three: true, lenis: true }, canvases: [1] }).visual_effects;
    expect(three.overview).toMatchObject({ primary_technology: "WebGL/Three.js", performance_tier: "heavy" });
    expect(three["3d_elements"]).toMatchObject({ enabled: true, technology: "Three.js" });
    expect(three.canvas_drawings.enabled).toBe(false);
    expect(three.scroll_effects.scroll_triggered_animations).toMatchObject({ enabled: true, scrub_behavior: "lenis smooth-scroll detected" });

    const canvas = enrich(skeleton(""), { frameworks: { gsap: true }, counts: { canvas: 2 } });
    expect(canvas._recon_signals.canvas_count).toBe(2);
    expect(canvas.visual_effects.overview.primary_technology).toBe("Canvas 2D");
    expect(canvas.visual_effects.canvas_drawings.enabled).toBe(true);
    expect(canvas.visual_effects.scroll_effects.scroll_triggered_animations.scrub_behavior).toBe("gsap detected");

    const gsap = enrich(skeleton(""), { frameworks: { gsap: true }, canvases: [] }).visual_effects;
    expect(gsap.overview.primary_technology).toBe("GSAP");

    const none = enrich(skeleton(""), {}).visual_effects;
    expect(none.overview.primary_technology).toBe("");
    expect(none.scroll_effects.scroll_triggered_animations.enabled).toBe(false);
  });
});

describe("main", () => {
  it("prints usage: exit 0 for --help, 1 without --out", () => {
    const { io, out } = makeIo("/");
    expect(main({ argv: ["--help"] }, io)).toBe(0);
    expect(main({ argv: ["--recon", "r.json"] }, io)).toBe(1);
    expect(out.logs).toHaveLength(2);
    expect(out.logs[0]).toContain("node scripts/dna-scaffold.mjs --out <design-dna.json>");
  });

  it("writes an enriched DNA from a recon file and summarizes the prefill", () => {
    const dir = makeTempDir("wc1-dna-");
    fs.writeFileSync(path.join(dir, "r.json"), JSON.stringify({
      url: "https://o.test/",
      captures: [{ viewport: { width: 1440 }, signals: { title: "T", fonts: ["Brand"], frameworks: { gsap: true }, counts: { canvas: 1 } } }],
    }));
    const { io, out } = makeIo(dir);
    expect(main({ argv: ["--recon", "r.json", "--out", "dna/design-dna.json"] }, io)).toBe(0);
    const file = path.join(dir, "dna", "design-dna.json");
    const dna = readJson(file);
    expect(dna.meta).toMatchObject({ name: "T", source_references: "https://o.test/" });
    expect(fs.readFileSync(file, "utf8").endsWith("}\n")).toBe(true);
    expect(out.logs).toEqual([
      `✅ design-dna 骨架已写入: ${file}`,
      "   预填: 字体 1 个 / 色候选 0 个 / canvas 1 / three=false gsap=true lenis=false",
      '   下一步: 人工 Analyze 补全 ""，并从 _recon_signals 指派颜色角色。schema → references/design-dna.md',
    ]);
  });

  it("writes the bare skeleton (with a warning when the recon is unusable)", () => {
    const dir = makeTempDir("wc1-dna-");
    fs.writeFileSync(path.join(dir, "null.json"), "null");
    const { io, out } = makeIo(dir);
    expect(main({ argv: ["--out", "a.json", "--name", "Acme"] }, io)).toBe(0);
    expect(readJson(path.join(dir, "a.json"))).toEqual(skeleton("Acme"));
    expect(main({ argv: ["--out", "b.json", "--recon", "missing.json"] }, io)).toBe(0);
    expect(main({ argv: ["--out", "c.json", "--recon", "null.json"] }, io)).toBe(0);
    expect(readJson(path.join(dir, "c.json"))).toEqual(skeleton(""));
    expect(out.warns).toHaveLength(2);
    expect(out.warns[0]).toMatch(/^⚠️ 读 recon 失败\(ENOENT.*\)，只输出空骨架。$/);
    expect(out.logs.filter((l) => l.includes("预填:"))).toEqual([]);
  });

  it("exits 1 with a message when the output cannot be written", () => {
    const dir = makeTempDir("wc1-dna-");
    fs.writeFileSync(path.join(dir, "file"), "");
    const { io, out } = makeIo(dir);
    expect(main({ argv: ["--out", "file/dna.json"] }, io)).toBe(1);
    expect(out.errors[0]).toMatch(/^dna-scaffold 失败: (EEXIST|ENOTDIR)/);
  });

  it("uses the real fs and console when no ports are injected", () => {
    const dir = makeTempDir("wc1-dna-");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const file = path.join(dir, "d.json");
    expect(main({ argv: ["--out", file] })).toBe(0);
    expect(readJson(file)).toEqual(skeleton(""));
  });
});
