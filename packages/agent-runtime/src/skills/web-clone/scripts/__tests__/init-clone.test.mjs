import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanSlug, main, notesTemplate, parseArgs } from "../init-clone.mjs";
import { makeIo, makeTempDir } from "./fakes-wc1.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseArgs", () => {
  it("takes the first positional as the slug and reads every flag", () => {
    expect(parseArgs([])).toEqual({ slug: null, url: "", mode: "", level: "", root: ".", inPlace: false });
    expect(parseArgs(["--url", "https://a.test", "nike", "--mode", "visual", "--level", "L3", "--root", "/w", "--in-place", "-h"])).toEqual({
      slug: "nike", url: "https://a.test", mode: "visual", level: "L3", root: "/w", inPlace: true, help: true,
    });
    expect(parseArgs(["--root"]).root).toBe(".");
    expect(parseArgs(["--help"]).help).toBe(true);
  });

  it("rejects a second positional argument", () => {
    expect(() => parseArgs(["a", "b"])).toThrow("Unexpected argument: b");
  });
});

describe("cleanSlug", () => {
  it("lowercases, strips the scheme and collapses non-alphanumerics to single dashes", () => {
    expect(cleanSlug("  https://www.Nike.com/US/  ")).toBe("www-nike-com-us");
    expect(cleanSlug("--Hello__World--")).toBe("hello-world");
    expect(cleanSlug("!!!")).toBe("");
  });
});

describe("notesTemplate", () => {
  it("fills the name, source URL, level and mode into the notes skeleton", () => {
    const md = notesTemplate({ name: "nike-clone", url: "https://nike.com", mode: "视觉复刻", level: "L3" });
    expect(md.startsWith("# nike-clone · 克隆笔记\n\n## 源信息\n- 原站 URL: https://nike.com\n")).toBe(true);
    expect(md).toContain("- 复杂度等级: L3\n- 推荐模式: 视觉复刻\n");
    expect(md).toContain("```bash\npython3 -m http.server 8123\n```");
    expect(md.endsWith("- 验证不了的点（如实记，别伪造）:\n")).toBe(true);
  });
});

describe("main", () => {
  it("prints usage: exit 0 for --help, 1 without a slug", () => {
    const { io, out } = makeIo("/");
    expect(main({ argv: ["--help"] }, io)).toBe(0);
    expect(main({ argv: ["--url", "https://a.test"] }, io)).toBe(1);
    expect(out.logs).toHaveLength(2);
    expect(out.logs[0]).toContain("node scripts/init-clone.mjs <slug>");
  });

  it("creates <root>/<slug>-clone with NOTES.md, RECON/screenshots and .gitignore", () => {
    const dir = makeTempDir("wc1-init-");
    const { io, out } = makeIo(dir);
    expect(main({ argv: ["Nike Store", "--url", "https://nike.com", "--mode", "m", "--level", "L2", "--root", "work"] }, io)).toBe(0);
    const project = path.join(dir, "work", "nike-store-clone");
    expect(out.logs).toEqual([project]);
    expect(fs.statSync(path.join(project, "RECON", "screenshots")).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(project, "NOTES.md"), "utf8")).toBe(notesTemplate({ name: "nike-store-clone", url: "https://nike.com", mode: "m", level: "L2" }));
    expect(fs.readFileSync(path.join(project, ".gitignore"), "utf8")).toBe("node_modules/\n.DS_Store\n");
  });

  it("does not double the -clone suffix and refuses to overwrite an existing project", () => {
    const dir = makeTempDir("wc1-init-");
    const { io, out } = makeIo(dir);
    expect(main({ argv: ["acme-clone"] }, io)).toBe(0);
    expect(out.logs).toEqual([path.join(dir, "acme-clone")]);
    expect(main({ argv: ["acme"] }, io)).toBe(1);
    expect(out.errors).toEqual([`init-clone failed: Project already exists: ${path.join(dir, "acme-clone")}`]);
  });

  it("--in-place scaffolds into the root itself, even when it already exists", () => {
    const dir = makeTempDir("wc1-init-");
    const { io, out } = makeIo(dir);
    expect(main({ argv: ["acme", "--in-place"] }, io)).toBe(0);
    expect(out.logs).toEqual([dir]);
    expect(fs.readFileSync(path.join(dir, "NOTES.md"), "utf8")).toContain("# acme-clone · 克隆笔记");
    expect(fs.existsSync(path.join(dir, "RECON", "screenshots"))).toBe(true);
  });

  it("exits 1 when the slug normalizes to nothing or an argument is unexpected", () => {
    const { io, out } = makeIo(makeTempDir("wc1-init-"));
    expect(main({ argv: ["***"] }, io)).toBe(1);
    expect(main({ argv: ["a", "b"] }, io)).toBe(1);
    expect(out.errors).toEqual(["init-clone failed: Slug is empty after normalization.", "init-clone failed: Unexpected argument: b"]);
  });

  it("uses the real fs and console when no ports are injected", () => {
    const dir = makeTempDir("wc1-init-");
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main({ argv: ["demo", "--root", dir] })).toBe(0);
    expect(fs.existsSync(path.join(dir, "demo-clone", "NOTES.md"))).toBe(true);
  });
});
