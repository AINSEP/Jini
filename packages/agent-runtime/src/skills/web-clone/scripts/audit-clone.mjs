#!/usr/bin/env node
// Module shape: importing this file has no side effects. The CLI edge at the
// bottom runs `main` only when the file is executed directly; `main` takes fs,
// console and cwd as an optional ports object and returns the exit code.
import fs from "node:fs";
import path from "node:path";
import { flag, list, parseCliArgs, rejectUnknown, runIfMain, text as textValue } from "./lib/script-cli.mjs";

export function usage(log) {
  log(`Usage:
  node scripts/audit-clone.mjs --project <clone-dir> [--brand "KOKUYO,Original Brand"] [--out CLONE_AUDIT.md]
    [--recon RECON/original-recon.json] [--strict]

Scans clone source files for tracking scripts, original-brand residue, Japanese residue, TODOs, and risky external dependencies.
With --recon, additionally runs fidelity gates against the original recon (fonts self-hosted?
images actually downloaded? key section colors exact?). --strict exits 2 on fidelity findings
so the clone workflow can hard-gate on it.
`);
}

// `project` is resolved against the cwd port, so "." means the cwd (the
// historical default, also used when --project has no value).
const ARG_SPEC = {
  defaults: { project: ".", brand: [], out: "CLONE_AUDIT.md", recon: "", strict: false },
  flags: {
    "--help": flag("help"),
    "-h": flag("help"),
    "--project": { key: "project", read: textValue(".") },
    "--brand": { key: "brand", read: list() },
    "--out": { key: "out", read: textValue("CLONE_AUDIT.md") },
    "--recon": { key: "recon", read: textValue() },
    "--strict": flag("strict"),
  },
  onOther: rejectUnknown,
};

export function parseArgs(argv) {
  return parseCliArgs(argv, ARG_SPEC);
}

// ---- Fidelity gates (fonts / images / palette vs. the original recon) ------

const GENERIC_FONT_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "-apple-system", "blinkmacsystemfont", "segoe ui", "roboto", "helvetica",
  "helvetica neue", "arial", "pingfang sc", "microsoft yahei", "ui-sans-serif",
  "ui-serif", "ui-monospace", "times new roman", "georgia", "courier new",
]);

const firstSignals = (recon) => recon?.captures?.[0]?.signals || {};

function declaredFamilies(signals) {
  return (signals.fontFaces || []).filter((face) => face.family).map((face) => face.family.trim());
}

function usedCustomFamilies(signals) {
  return (signals.fonts || [])
    .map((family) => String(family).replace(/['"]/g, "").trim())
    .filter((clean) => clean && !GENERIC_FONT_FAMILIES.has(clean.toLowerCase()));
}

export function customFontFamilies(recon) {
  const first = firstSignals(recon);
  return Array.from(new Set([...declaredFamilies(first), ...usedCustomFamilies(first)]));
}

// rgb()/rgba()/#hex → "r,g,b"; null for transparent (alpha 0) / unparseable —
// a transparent original color enforces nothing on the clone.
export function normalizeColor(value) {
  const v = String(value || "").trim().toLowerCase();
  let m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/);
  if (m) {
    if (m[4] !== undefined && Number(m[4]) === 0) return null;
    return `${m[1]},${m[2]},${m[3]}`;
  }
  m = v.match(/^#([0-9a-f]{3})$/);
  if (m) return m[1].split("").map((c) => parseInt(c + c, 16)).join(",");
  m = v.match(/^#([0-9a-f]{6})/);
  if (m) return [m[1].slice(0, 2), m[1].slice(2, 4), m[1].slice(4, 6)].map((h) => parseInt(h, 16)).join(",");
  return null;
}

const isMarkup = (file) => [".html", ".css"].includes(path.extname(file).toLowerCase());

function collectCloneColors(files, fsImpl) {
  const colors = new Set();
  for (const file of files.filter(isMarkup)) {
    const text = fsImpl.readFileSync(file, "utf8");
    for (const m of text.matchAll(/#[0-9a-f]{3}\b|#[0-9a-f]{6}\b|rgba?\([^)]*\)/gi)) {
      const norm = normalizeColor(m[0]);
      if (norm) colors.add(norm);
    }
  }
  return colors;
}

// 字体: 原站有自定义字体 → 复刻必须有本地字体文件 + @font-face。
function fontFindings(recon, files, fsImpl) {
  const wantedFamilies = customFontFamilies(recon);
  if (!wantedFamilies.length) return [];
  const families = wantedFamilies.join(", ");
  if (!files.some((f) => /\.(woff2?|ttf|otf)$/i.test(f))) {
    return [["fonts not self-hosted", `original uses custom fonts (${families}) but the clone ships no local font files — run asset-harvest and link fonts/fonts.css`]];
  }
  const hasFontFace = files.filter(isMarkup).some((f) => /@font-face/i.test(fsImpl.readFileSync(f, "utf8")));
  return hasFontFace ? [] : [["fonts downloaded but unused", `local font files exist but no @font-face references them (${families})`]];
}

// 图片: 原站真实加载过图片 → 复刻必须落地本地图片文件，不许全靠占位。
function imageFindings(first, files) {
  const originalImageCount = (first.resources?.images || first.images || []).length;
  if (originalImageCount < 3 || files.some((f) => /\.(png|jpe?g|gif|webp|avif)$/i.test(f))) return [];
  return [["images not harvested", `original loaded ${originalImageCount} images but the clone ships zero local image files — placeholders/gradients are not a clone`]];
}

// 颜色: 关键区块(body/header/footer)的计算色必须在复刻源码里逐字出现。
// A transparent / unparseable original value has nothing to enforce.
function paletteFindings(first, files, fsImpl) {
  const cloneColors = collectCloneColors(files, fsImpl);
  const findings = [];
  for (const key of ["body", "header", "footer"]) {
    const section = first.palette?.[key] || {};
    for (const prop of ["backgroundColor", "color"]) {
      const norm = normalizeColor(section[prop]);
      if (norm && !cloneColors.has(norm)) {
        findings.push([`palette mismatch: ${key} ${prop}`, `original computed ${section[prop]} (rgb ${norm}) not found anywhere in clone css/html — copy the exact value from recon, do not eyeball`]);
      }
    }
  }
  return findings;
}

/** Fidelity gates (fonts / images / palette) of `files` (every file, binaries included) vs the recon. */
export function fidelityFindings(recon, project, files, fsImpl = fs) {
  const first = firstSignals(recon);
  return [...fontFindings(recon, files, fsImpl), ...imageFindings(first, files), ...paletteFindings(first, files, fsImpl)]
    .map(([label, detail]) => ({ type: "fidelity", label, file: project, line: 0, match: detail }));
}

const includeExt = new Set([".html", ".css", ".js", ".jsx", ".ts", ".tsx", ".json", ".md", ".txt", ".svg"]);
const skipDirs = new Set([".git", "node_modules", "dist", "build", ".next", ".nuxt", "coverage", "RECON"]);
const skipFiles = new Set(["NOTES.md", "TEARDOWN.md", "CLONE_REPORT.md", "CLONE_AUDIT.md", "REPLACE_GUIDE.md"]);

/** Text sources to scan: skips build/vendor dirs, screenshots/, notes files and binaries. */
export function walk(dir, fsImpl = fs, files = []) {
  for (const entry of fsImpl.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "screenshots") walk(full, fsImpl, files);
    } else if (!skipFiles.has(entry.name) && includeExt.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

// walk() 跳过了字体/图片二进制，保真门槛需要一份含它们的完整清单。
function walkAll(dir, fsImpl, files = []) {
  for (const entry of fsImpl.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkAll(full, fsImpl, files);
    else files.push(full);
  }
  return files;
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

const W3_URL = /^https?:\/\/(www\.)?w3\.org\//i;

export function collectMatches(file, text, checks) {
  const findings = [];
  for (const check of checks) {
    const regex = new RegExp(check.pattern, check.flags || "gi");
    for (const match of text.matchAll(regex)) {
      const matchedText = String(match[0]);
      // XML/SVG namespace URLs are not dependencies.
      if (check.type === "external" && W3_URL.test(matchedText)) continue;
      findings.push({ type: check.type, label: check.label, file, line: lineNumber(text, match.index), match: matchedText.slice(0, 160) });
    }
  }
  return findings;
}

const SECTION_TITLES = [
  ["fidelity", "保真度硬伤（字体 / 图片 / 颜色）"],
  ["tracking", "追踪脚本 / 统计像素"],
  ["brand", "原站品牌残留"],
  ["japanese", "日文残留"],
  ["todo", "TODO / 占位内容"],
  ["external", "外部依赖 / 外链风险"],
];

function sectionLines(title, items, project) {
  if (!items.length) return [`## ${title}`, "- 未发现", ""];
  const lines = [`## ${title}`];
  for (const item of items.slice(0, 200)) {
    lines.push(`- ${path.relative(project, item.file)}:${item.line} · ${item.label} · \`${item.match.replaceAll("`", "'")}\``);
  }
  if (items.length > 200) lines.push(`- 还有 ${items.length - 200} 条未展开`);
  lines.push("");
  return lines;
}

export function markdown(findings, project, scannedFiles) {
  const lines = [
    `# Clone Audit`,
    "",
    `- Project: ${project}`,
    `- Scanned files: ${scannedFiles}`,
    `- Findings: ${findings.length}`,
    "",
  ];
  for (const [type, title] of SECTION_TITLES) {
    lines.push(...sectionLines(title, findings.filter((finding) => finding.type === type), project));
  }
  lines.push("## 结论");
  lines.push(findings.length ? "- 需要处理上面的残留项后再声明可部署。" : "- 未发现明显残留项；仍需人工核查素材授权和视觉截图。");
  return `${lines.join("\n")}\n`;
}

const BASE_CHECKS = [
  { type: "tracking", label: "Google Tag Manager", pattern: "googletagmanager|GTM-[A-Z0-9]+", flags: "gi" },
  { type: "tracking", label: "Google Analytics / gtag", pattern: "google-analytics|gtag\\s*\\(|ga\\s*\\(", flags: "gi" },
  { type: "tracking", label: "Meta Pixel / fbq", pattern: "connect\\.facebook\\.net|fbq\\s*\\(", flags: "gi" },
  { type: "tracking", label: "Hotjar / Clarity", pattern: "hotjar|clarity\\.ms|hj\\s*\\(", flags: "gi" },
  { type: "japanese", label: "Japanese kana residue", pattern: "[\\u3040-\\u30ff]{2,}", flags: "g" },
  { type: "todo", label: "TODO / placeholder content", pattern: "TODO|FIXME|lorem ipsum|待补|这里填写", flags: "gi" },
  { type: "external", label: "external URL", pattern: "https?://[^\\s\"')<>]+", flags: "gi" },
];

export function buildChecks(brands) {
  const brandPatterns = brands.map((brand) => ({
    type: "brand",
    label: `brand residue: ${brand}`,
    pattern: brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    flags: "gi",
  }));
  return [...BASE_CHECKS, ...brandPatterns];
}

// 字体/图片/颜色保真门槛——只在提供 --recon 时启用。
function reconFidelity(args, project, io) {
  if (!args.recon) return [];
  const recon = JSON.parse(io.fs.readFileSync(path.resolve(io.cwd(), args.recon), "utf8"));
  return fidelityFindings(recon, project, walkAll(project, io.fs), io.fs);
}

function audit(argv, io) {
  const args = parseArgs(argv);
  if (args.help) {
    usage(io.log);
    return 0;
  }
  const project = path.resolve(io.cwd(), args.project);
  if (!io.fs.existsSync(project)) throw new Error(`Project not found: ${project}`);

  const checks = buildChecks(args.brand);
  const files = walk(project, io.fs);
  const fidelity = reconFidelity(args, project, io);
  const findings = [...fidelity, ...files.flatMap((file) => collectMatches(file, io.fs.readFileSync(file, "utf8"), checks))];

  const output = path.resolve(io.cwd(), args.out);
  io.fs.mkdirSync(path.dirname(output), { recursive: true });
  io.fs.writeFileSync(output, markdown(findings, project, files.length));
  io.log(output);
  if (!fidelity.length) return 0;
  io.error(`⚠️ ${fidelity.length} 个保真度硬伤（详见 ${path.relative(io.cwd(), output)}）：`);
  for (const item of fidelity) io.error(`   - ${item.label}: ${item.match}`);
  return args.strict ? 2 : 0;
}

const DEFAULT_DEPS = { fs, log: console.log, error: console.error, cwd: process.cwd };

/**
 * CLI entry: writes the audit markdown and returns the exit code — 0 ok/help,
 * 2 when --strict and a fidelity gate failed, 1 on any error.
 */
export function main({ argv }, deps = {}) {
  const io = { ...DEFAULT_DEPS, ...deps };
  let code = 1;
  try {
    code = audit(argv, io);
  } catch (error) {
    io.error(`audit-clone failed: ${error.message}`);
  }
  return code;
}

await runIfMain({ moduleUrl: import.meta.url, main });
