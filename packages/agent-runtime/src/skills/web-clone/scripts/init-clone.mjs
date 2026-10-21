#!/usr/bin/env node
// Module shape: importing this file has no side effects. The CLI edge at the
// bottom runs `main` only when the file is executed directly; `main` takes fs,
// console and cwd as an optional ports object and returns the exit code.
import fs from "node:fs";
import path from "node:path";
import { flag, parseCliArgs, rejectUnknown, runIfMain, text } from "./lib/script-cli.mjs";

export function usage(log) {
  log(`Usage:
  node scripts/init-clone.mjs <slug> [--url <url>] [--mode <mode>] [--level <L1-L6>] [--root <dir>] [--in-place]

Creates:
  <root>/<slug>-clone/
  <root>/<slug>-clone/NOTES.md
  <root>/<slug>-clone/RECON/screenshots/

With --in-place, creates NOTES.md and RECON/screenshots/ in <root> itself.
`);
}

// `root` is resolved against the cwd port, so "." means the cwd (the
// historical default, also used when --root has no value). The first
// positional argument is the slug; a second one is an error.
const ARG_SPEC = {
  defaults: { slug: null, url: "", mode: "", level: "", root: ".", inPlace: false },
  flags: {
    "--help": flag("help"),
    "-h": flag("help"),
    "--url": { key: "url", read: text() },
    "--mode": { key: "mode", read: text() },
    "--level": { key: "level", read: text() },
    "--root": { key: "root", read: text(".") },
    "--in-place": flag("inPlace"),
  },
  onOther: (arg, out) => {
    if (out.slug) rejectUnknown(arg);
    out.slug = arg;
  },
};

export function parseArgs(argv) {
  return parseCliArgs(argv, ARG_SPEC);
}

export function cleanSlug(input) {
  return input
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function notesTemplate({ name, url, mode, level }) {
  return `# ${name} · 克隆笔记

## 源信息
- 原站 URL: ${url}
- 源码仓库:
- 原作者:
- 许可证:
- 致谢要求:

## 技术栈
- 框架 / 关键库 / Node 版本:

## 复刻前预判
- 复杂度等级: ${level}
- 推荐模式: ${mode}
- 可高保真的部分:
- 需要近似或替代的部分:
- 不克隆的部分:
- 主要风险:

## 跑起来
\`\`\`bash
python3 -m http.server 8123
\`\`\`

## 改了什么（对照原版）
-

## 原站 vs 克隆站
| 模块 | 原站表现 | 克隆实现 | 差异 / 取舍 | 证据 |
|---|---|---|---|---|
| 首屏 |  |  |  |  |
| 导航 |  |  |  |  |
| 核心动效 |  |  |  |  |
| 内容区块 |  |  |  |  |
| 移动端 |  |  |  |  |

## 复刻评分
- 源证据: /5
- 结构保真: /5
- 视觉保真: /5
- 动效/交互: /5
- 响应式: /5
- 功能完整: /5
- 内容替换: /5
- 法务/部署风险: /5
- 总评:

## 替换地图（要换什么改哪）
- 文字 -> 文件 行
- 图片/媒体 -> 目录
- 配色 -> CSS 变量 / theme
- 3D 模型 / 字体 ->

## 验证
- [ ] 本地跑通、console 0 error
- [ ] 截图对照原站（RECON/screenshots/）
- 验证不了的点（如实记，别伪造）:
`;
}

function init(argv, io) {
  const args = parseArgs(argv);
  if (args.help || !args.slug) {
    usage(io.log);
    return args.help ? 0 : 1;
  }

  const slug = cleanSlug(args.slug);
  if (!slug) throw new Error("Slug is empty after normalization.");
  const name = slug.endsWith("-clone") ? slug : `${slug}-clone`;
  const root = path.resolve(io.cwd(), args.root);
  const project = args.inPlace ? root : path.join(root, name);

  if (!args.inPlace && io.fs.existsSync(project)) {
    throw new Error(`Project already exists: ${project}`);
  }

  io.fs.mkdirSync(path.join(project, "RECON", "screenshots"), { recursive: true });
  io.fs.writeFileSync(path.join(project, "NOTES.md"), notesTemplate({ name, url: args.url, mode: args.mode, level: args.level }));
  io.fs.writeFileSync(path.join(project, ".gitignore"), "node_modules/\n.DS_Store\n");
  io.log(project);
  return 0;
}

const DEFAULT_DEPS = { fs, log: console.log, error: console.error, cwd: process.cwd };

/** CLI entry: scaffolds the clone folder; returns 0 ok/help, 1 on usage error or failure. */
export function main({ argv }, deps = {}) {
  const io = { ...DEFAULT_DEPS, ...deps };
  let code = 1;
  try {
    code = init(argv, io);
  } catch (error) {
    io.error(`init-clone failed: ${error.message}`);
  }
  return code;
}

await runIfMain({ moduleUrl: import.meta.url, main });
