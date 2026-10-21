#!/usr/bin/env node
// Module shape: importing this file has no side effects. The CLI edge at the
// bottom runs `main` only when the file is executed directly; `main` takes fs,
// console and cwd as an optional ports object and returns the exit code.
import fs from "node:fs";
import path from "node:path";
import { flag, parseCliArgs, rejectUnknown, runIfMain, text } from "./lib/script-cli.mjs";

export function usage(log) {
  log(`Usage:
  node scripts/compare-recon.mjs --original <original-recon.json> --clone <clone-recon.json> [--visual-diff visual-diff.json] [--original-routes route-map.json] [--clone-routes route-map.json] [--original-interactions interactions.json] [--clone-interactions interactions.json] [--out CLONE_REPORT.md]
`);
}

const EVIDENCE_FLAGS = {
  "--visual-diff": "visualDiff",
  "--original-routes": "originalRoutes",
  "--clone-routes": "cloneRoutes",
  "--original-interactions": "originalInteractions",
  "--clone-interactions": "cloneInteractions",
};

const ARG_SPEC = {
  defaults: {
    original: "",
    clone: "",
    ...Object.fromEntries(Object.values(EVIDENCE_FLAGS).map((key) => [key, ""])),
    out: "CLONE_REPORT.md",
  },
  flags: {
    "--help": flag("help"),
    "-h": flag("help"),
    "--original": { key: "original", read: text() },
    "--clone": { key: "clone", read: text() },
    ...Object.fromEntries(Object.entries(EVIDENCE_FLAGS).map(([arg, key]) => [arg, { key, read: text() }])),
    "--out": { key: "out", read: text("CLONE_REPORT.md") },
  },
  onOther: rejectUnknown,
};

export function parseArgs(argv) {
  return parseCliArgs({ argv, ...ARG_SPEC });
}

function firstSignals(recon) {
  return recon.captures?.[0]?.signals || {};
}

function boolList(flags = {}) {
  return Object.entries(flags).filter(([, value]) => value).map(([key]) => key);
}

/** A signal count, 0 when absent. */
const countOf = (signals, key) => signals.counts?.[key] || 0;

const RATIO_STEPS = [[0.9, 5], [0.75, 4], [0.55, 3], [0.3, 2]];

/** 1..5 closeness of two counts; both zero is a perfect match, one zero the worst. */
export function ratioScore(a, b) {
  if (a === 0 && b === 0) return 5;
  if (a === 0 || b === 0) return 1;
  const ratio = Math.min(a, b) / Math.max(a, b);
  const step = RATIO_STEPS.find(([floor]) => ratio > floor);
  return step ? step[1] : 1;
}

/** Share of `tag:text` heading keys present on both sides (1 when both are empty). */
export function sequenceSimilarity(a, b) {
  const left = a.map((item) => `${item.tag}:${item.text}`).filter(Boolean);
  const right = b.map((item) => `${item.tag}:${item.text}`).filter(Boolean);
  if (!left.length && !right.length) return 1;
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  const hits = left.filter((item) => rightSet.has(item)).length;
  return hits / Math.max(left.length, right.length);
}

const SPA_FRAMEWORKS = ["react", "next", "vue", "nuxt", "svelte", "astro"];

// First matching level wins, most demanding first.
const COMPLEXITY_RULES = [
  ["L6", (s) => countOf(s, "forms") > 2 && countOf(s, "inputs") > 10],
  ["L5", (s) => countOf(s, "canvas") > 0 || Boolean(s.frameworks?.three)],
  ["L4", (s) => Boolean(s.frameworks?.gsap || s.frameworks?.lenis) || countOf(s, "video") > 2],
  ["L3", (s) => boolList(s.frameworks).some((name) => SPA_FRAMEWORKS.includes(name))],
  ["L2", (s) => countOf(s, "links") > 80 || countOf(s, "images") > 40],
];

export function inferComplexity(signals) {
  const rule = COMPLEXITY_RULES.find(([, test]) => test(signals));
  return rule ? rule[0] : "L1";
}

function averageRatio(o, c, keys) {
  const scores = keys.map((key) => ratioScore(countOf(o, key), countOf(c, key)));
  return Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
}

export function score(original, clone, visualDiff) {
  const o = firstSignals(original);
  const c = firstSignals(clone);
  const structureSimilarity = sequenceSimilarity(o.headings || [], c.headings || []);
  return {
    sourceEvidence: 3,
    structure: Math.max(1, Math.round(structureSimilarity * 5)),
    visual: visualDiff ? `${visualDiff.visualScore}/5` : "需人工看截图或传 --visual-diff",
    interaction: averageRatio(o, c, ["canvas", "video"]),
    responsive: original.captures?.length === clone.captures?.length ? 4 : 2,
    functional: averageRatio(o, c, ["links", "forms", "buttons", "inputs"]),
    contentReplacement: "需人工看文案残留",
    legalRisk: "需人工核查 license / 素材",
  };
}

function line(value) {
  if (Array.isArray(value)) return value.join(", ") || "none";
  return value ?? "";
}

function routePath(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

export function routesSection(files, evidence) {
  if (!evidence.originalRoutes || !evidence.cloneRoutes) {
    return `## 路由覆盖
- 未提供 route-crawl 结果。多页面站需要传 --original-routes / --clone-routes。
`;
  }
  const originalSet = new Set((evidence.originalRoutes.routes || []).map((route) => routePath(route.url)));
  const cloneSet = new Set((evidence.cloneRoutes.routes || []).map((route) => routePath(route.url)));
  const matched = Array.from(originalSet).filter((item) => cloneSet.has(item));
  const missing = Array.from(originalSet).filter((item) => !cloneSet.has(item));
  const extra = Array.from(cloneSet).filter((item) => !originalSet.has(item));
  const coverage = originalSet.size ? Math.round((matched.length / originalSet.size) * 100) : 100;
  return `## 路由覆盖
- 原站路由: ${originalSet.size}
- 克隆路由: ${cloneSet.size}
- 覆盖率: ${coverage}%
- 原站 route map: ${files.originalRoutes}
- 克隆 route map: ${files.cloneRoutes}
- 缺失路由: ${missing.join(", ") || "无"}
- 额外路由: ${extra.join(", ") || "无"}
`;
}

function interactionStats(probe) {
  const actions = probe.actions || [];
  return {
    actions: actions.length,
    changed: actions.filter((action) => action.changed).length,
    canvas: probe.discovered?.canvases?.length || 0,
    interactive: probe.discovered?.interactive?.length || 0,
  };
}

export function interactionSection(files, evidence) {
  if (!evidence.originalInteractions || !evidence.cloneInteractions) {
    return `## 交互覆盖
- 未提供 interaction-probe 结果。交互站需要传 --original-interactions / --clone-interactions。
`;
  }
  const o = interactionStats(evidence.originalInteractions);
  const c = interactionStats(evidence.cloneInteractions);
  const close = o.changed === c.changed && o.canvas === c.canvas;
  return `## 交互覆盖
- 原站可见交互目标: ${o.interactive}
- 克隆可见交互目标: ${c.interactive}
- 原站 canvas 目标: ${o.canvas}
- 克隆 canvas 目标: ${c.canvas}
- 原站 changed actions: ${o.changed}/${o.actions}
- 克隆 changed actions: ${c.changed}/${c.actions}
- 原站 interaction probe: ${files.originalInteractions}
- 克隆 interaction probe: ${files.cloneInteractions}
- 判断: ${close ? "交互数量信号接近，仍需看截图确认状态质量。" : "交互数量信号不一致，需要检查缺失状态或过度实现。"}
`;
}

const MODE_BY_COMPLEXITY = { L5: "技术拆解 / 忠实复刻优先", L6: "展示层视觉复刻" };
const COUNT_KEYS = ["sections", "links", "images", "video", "canvas", "forms", "buttons", "inputs", "interactive", "scripts"];

function techSignalsTable(o, c) {
  return `| 项目 | 原站 | 克隆站 |
|---|---|---|
| title | ${o.title || ""} | ${c.title || ""} |
| lang | ${o.lang || ""} | ${c.lang || ""} |
| frameworks | ${line(boolList(o.frameworks))} | ${line(boolList(c.frameworks))} |
| scrollHeight | ${o.scrollHeight || 0} | ${c.scrollHeight || 0} |
| h1 | ${line(o.h1)} | ${line(c.h1)} |`;
}

function countRows(o, c) {
  return COUNT_KEYS.map((key) => `| ${key} | ${countOf(o, key)} | ${countOf(c, key)} | ${ratioScore(countOf(o, key), countOf(c, key))}/5 |`).join("\n");
}

function consoleCounts(recon) {
  return { errors: recon.console?.errors?.length || 0, pageErrors: recon.console?.pageErrors?.length || 0 };
}

const screenshots = (recon) => (recon.captures || []).map((capture) => capture.screenshot).join(", ");

export function report(files, original, clone, evidence) {
  const o = firstSignals(original);
  const c = firstSignals(clone);
  const scores = score(original, clone, evidence.visualDiff);
  const complexity = inferComplexity(o);
  const oc = consoleCounts(original);
  const cc = consoleCounts(clone);

  return `# ${original.label || "original"} vs ${clone.label || "clone"} · 克隆评估报告

## 结论
- 原站 URL: ${original.url}
- 克隆 URL: ${clone.url}
- 自动推断复杂度: ${complexity}
- 复刻模式建议: ${MODE_BY_COMPLEXITY[complexity] || "视觉复刻 / 内容爆改"}
- 自动报告边界: 结构、数量、框架、console 可自动比；传入 visual-diff 后可纳入像素差异分。内容残留和法务仍需审计。

## 技术信号
${techSignalsTable(o, c)}

## 数量对比
| 指标 | 原站 | 克隆站 | 自动评分 |
|---|---:|---:|---:|
${countRows(o, c)}

## 复刻评分
- 源证据: ${scores.sourceEvidence}/5
- 结构保真: ${scores.structure}/5
- 视觉保真: ${scores.visual}
- 动效/交互: ${scores.interaction}/5
- 响应式: ${scores.responsive}/5
- 功能完整: ${scores.functional}/5
- 内容替换: ${scores.contentReplacement}
- 法务/部署风险: ${scores.legalRisk}

## Console
- 原站 console errors: ${oc.errors}
- 克隆 console errors: ${cc.errors}
- 原站 page errors: ${oc.pageErrors}
- 克隆 page errors: ${cc.pageErrors}

${routesSection(files, evidence)}

${interactionSection(files, evidence)}

## 截图证据
- 原站侦察: ${files.original}
- 克隆侦察: ${files.clone}
- 像素差异: ${files.visualDiff || "未提供"}
- 像素差异率: ${evidence.visualDiff ? evidence.visualDiff.diffPixelRatio : "未提供"}
- 原站截图: ${screenshots(original)}
- 克隆截图: ${screenshots(clone)}

## 已知缺口
- 未传入 visual-diff 时，视觉保真需要打开截图人工确认。
- 法务、素材授权、品牌替换完整度需要人工核查。
`;
}

function compare(argv, io) {
  const args = parseArgs(argv);
  if (args.help || !args.original || !args.clone) {
    usage(io.log);
    return args.help ? 0 : 1;
  }
  // Optional evidence files are read only when their flag was given.
  const readJson = (file) => (file ? JSON.parse(io.fs.readFileSync(path.resolve(io.cwd(), file), "utf8")) : null);
  const original = readJson(args.original);
  const clone = readJson(args.clone);
  const evidence = Object.fromEntries(Object.values(EVIDENCE_FLAGS).map((key) => [key, readJson(args[key])]));
  const output = path.resolve(io.cwd(), args.out);
  io.fs.mkdirSync(path.dirname(output), { recursive: true });
  io.fs.writeFileSync(output, report(args, original, clone, evidence));
  io.log(output);
  return 0;
}

const DEFAULT_DEPS = { fs, log: console.log, error: console.error, cwd: process.cwd };

/** CLI entry: writes the comparison report; returns 0 ok/help, 1 on usage error or failure. */
export function main({ argv }, deps = {}) {
  const io = { ...DEFAULT_DEPS, ...deps };
  let code = 1;
  try {
    code = compare(argv, io);
  } catch (error) {
    io.error(`compare-recon failed: ${error.message}`);
  }
  return code;
}

await runIfMain({ moduleUrl: import.meta.url, main });
