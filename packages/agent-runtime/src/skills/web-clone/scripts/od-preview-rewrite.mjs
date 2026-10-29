#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { HELP_OPTIONS, parseCliArgs } from "./lib/cli-args.mjs";
import { runCli, runIfMain } from "./lib/main-guard.mjs";
import { replaceCssUrls } from "./lib/css-url.mjs";

// fs / cwd / output are ports with real defaults wired here at the CLI edge.
// The rewrite functions take a `project` = { root, fs } so they can be
// exercised against a temp directory (or any fs-shaped fake).
const DEFAULT_DEPS = { fs, cwd: () => process.cwd(), log: console.log, error: console.error };

export function usage(log = console.log) {
  log(`Usage:
  node scripts/od-preview-rewrite.mjs [--project <clone-dir>]

Rewrites project-root asset URLs in HTML/CSS/SVG files so the host platform's
file preview and exported zip can render the clone from nested entry files.
`);
}

export function parseArgs(argv, cwd) {
  return parseCliArgs({
    argv,
    defaults: { project: cwd, help: false },
    options: { ...HELP_OPTIONS, "--project": { key: "project", parse: (raw) => raw || cwd } },
  });
}

const includeExt = new Set([".html", ".htm", ".css", ".svg"]);
const skipDirs = new Set([
  ".git",
  ".next",
  ".nuxt",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "RECON",
]);

const projectAssetPrefixes = new Set([
  "_next",
  "asset",
  "assets",
  "assets-cdn",
  "audio",
  "css",
  "favicon",
  "file",
  "files",
  "flower",
  "flowers",
  "font",
  "fonts",
  "icon",
  "icons",
  "image",
  "images",
  "img",
  "install-screenshots",
  "js",
  "media",
  "public",
  "reference-assets",
  "script",
  "scripts",
  "static",
  "video",
  "videos",
]);

const hostRootPrefixes = new Set(["api", "artifacts", "frames"]);

export function walk(fsPort, dir, files = []) {
  for (const entry of fsPort.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walk(fsPort, path.join(dir, entry.name), files);
      continue;
    }
    if (includeExt.has(path.extname(entry.name).toLowerCase())) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

// "/x/y?q#h" → "x/y" for a project-root reference; "" for anything else
// (relative, protocol-relative "//cdn", or a bare "/"). The value starts
// with "/", so split(…, 1) always yields exactly one string.
function rootPathOnly(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "";
  return trimmed.split(/[?#]/, 1)[0].replace(/^\/+/, "").replace(/\\/g, "/");
}

function decodeOrKeep(pathOnly) {
  let decodedPath = pathOnly;
  try {
    decodedPath = decodeURIComponent(pathOnly);
  } catch {
    // Use the encoded path below.
  }
  return decodedPath;
}

// `parts` comes from String#split, so parts[0] and parts.at(-1) always exist.
function looksLikeProjectAsset(parts) {
  const first = parts[0].toLowerCase();
  if (!first || hostRootPrefixes.has(first)) return false;
  return projectAssetPrefixes.has(first) || /\.[a-z0-9][a-z0-9_-]{0,15}$/i.test(parts.at(-1));
}

/**
 * The project-relative path a root reference ("/assets/a.png") points at,
 * or null when it is not a root reference, escapes the project ("..") ,
 * targets a host route (/api, /artifacts, /frames), does not look like an
 * asset, or does not exist in the project.
 */
export function rootAssetPath(project, value) {
  const pathOnly = rootPathOnly(value);
  if (!pathOnly) return null;
  const decodedPath = decodeOrKeep(pathOnly);
  const parts = decodedPath.split("/");
  if (parts.some((part) => part.trim() === "..")) return null;
  if (!looksLikeProjectAsset(parts)) return null;
  if (!project.fs.existsSync(path.join(project.root, decodedPath))) return null;
  return decodedPath;
}

export function suffixFor(value) {
  return value.match(/^[^?#]*([?#][\s\S]*)$/)?.[1] ?? "";
}

export function relativeRef(projectRoot, ownerFile, targetPath, suffix) {
  const fromDir = path.dirname(ownerFile);
  const target = path.join(projectRoot, targetPath);
  let rel = path.relative(fromDir, target).split(path.sep).join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return `${rel}${suffix}`;
}

export function rewriteRootRef(project, ownerFile, value) {
  const target = rootAssetPath(project, value);
  if (!target) return value;
  return relativeRef(project.root, ownerFile, target, suffixFor(value));
}

export function rewriteSrcset(project, ownerFile, srcset) {
  return srcset
    .split(",")
    .map((candidate) => {
      // The whitespace around the body, kept verbatim; a non-empty trimmed
      // body always splits into a non-empty first token.
      const leading = candidate.slice(0, candidate.length - candidate.trimStart().length);
      const trailing = candidate.slice(candidate.trimEnd().length);
      const body = candidate.trim();
      if (!body) return candidate;
      const [url, ...descriptors] = body.split(/\s+/);
      return `${leading}${[rewriteRootRef(project, ownerFile, url), ...descriptors].join(" ")}${trailing}`;
    })
    .join(",");
}

// A site-root path ("/x"), not protocol-relative ("//host"): what the former regex's
// `\/(?!\/)[^'")]+` reference group admitted.
const isRootRelativeRef = (ref) => ref.length >= 2 && ref[0] === "/" && ref[1] !== "/";

export function rewriteCssUrls(project, ownerFile, text) {
  return replaceCssUrls(
    text,
    (match, quote, value) => {
      const rewritten = rewriteRootRef(project, ownerFile, value);
      if (rewritten === value) return match;
      const q = quote || "";
      return `url(${q}${rewritten}${q})`;
    },
    { accept: isRootRelativeRef },
  );
}

export function rewriteHtmlAttrs(project, ownerFile, text) {
  let next = text.replace(
    /(\s)(src|href|poster|data-src|data-tool-chip-src)\s*=\s*(['"])([\s\S]*?)\3/gi,
    (match, space, name, quote, value) => {
      const rewritten = rewriteRootRef(project, ownerFile, value);
      if (rewritten === value) return match;
      return `${space}${name}=${quote}${rewritten}${quote}`;
    },
  );
  next = next.replace(
    /(\s)srcset\s*=\s*(['"])([\s\S]*?)\2/gi,
    (match, space, quote, value) => {
      const rewritten = rewriteSrcset(project, ownerFile, value);
      if (rewritten === value) return match;
      return `${space}srcset=${quote}${rewritten}${quote}`;
    },
  );
  return next;
}

export function rewriteFile(project, file) {
  const before = project.fs.readFileSync(file, "utf8");
  const ext = path.extname(file).toLowerCase();
  let after = rewriteCssUrls(project, file, before);
  if (ext === ".html" || ext === ".htm" || ext === ".svg") {
    after = rewriteHtmlAttrs(project, file, after);
  }
  if (after === before) return false;
  project.fs.writeFileSync(file, after);
  return true;
}

function rewriteProject(args, deps) {
  const project = { root: path.resolve(args.project), fs: deps.fs };
  const files = walk(deps.fs, project.root);
  const changed = files.filter((file) => rewriteFile(project, file));
  for (const file of changed) {
    deps.log(path.relative(project.root, file).split(path.sep).join("/"));
  }
  deps.log(`od-preview-rewrite: ${changed.length} file(s) updated`);
  return 0;
}

/**
 * CLI entry: rewrite project-root asset URLs under --project (default cwd).
 * @returns {Promise<number>} exit code (0 ok, 1 failure).
 */
export async function main({ argv }, deps = {}) {
  const io = { ...DEFAULT_DEPS, ...deps };
  return runCli({ label: "od-preview-rewrite", body: () => {
    const args = parseArgs(argv, io.cwd());
    if (args.help) {
      usage(io.log);
      return 0;
    }
    return rewriteProject(args, io);
  }, report: io.error });
}

await runIfMain({ moduleUrl: import.meta.url, main });
