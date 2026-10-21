#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HELP_OPTIONS, parseCliArgs, text } from "./lib/cli-args.mjs";
import { runCli, runIfMain } from "./lib/main-guard.mjs";

// fs / fetch / output are ports with real defaults wired here at the CLI edge.
const DEFAULT_DEPS = { fs, fetch: globalThis.fetch, log: console.log, error: console.error };

export function usage(log = console.log) {
  log(`Usage:
  node scripts/sourcemap-hunt.mjs --recon original-recon.json --out RECON/sourcemaps [--all-external]

Finds sourceMappingURL hints in discovered JavaScript bundles and tries to download source maps.
`);
}

const ARG_SPEC = {
  defaults: { recon: "", outDir: "RECON/sourcemaps", allExternal: false },
  options: {
    ...HELP_OPTIONS,
    "--recon": { key: "recon", parse: text("") },
    "--out": { key: "outDir", parse: text("RECON/sourcemaps") },
    "--all-external": { key: "allExternal", flag: true },
  },
};

export function parseArgs(argv) {
  return parseCliArgs(argv, ARG_SPEC);
}

export function collectScripts(recon) {
  const scripts = new Set();
  for (const capture of recon.captures || []) {
    for (const script of capture.signals?.scripts || []) {
      if (/^https?:\/\//i.test(script)) scripts.add(script);
    }
  }
  return Array.from(scripts);
}

export function fileNameFor(url, suffix = "") {
  const parsed = new URL(url);
  const base = path.basename(parsed.pathname).replace(/[^a-z0-9._-]+/gi, "-").slice(0, 90) || "bundle.js";
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 10);
  return `${base}-${hash}${suffix}`;
}

export function resolveMapUrl(scriptUrl, mapHint) {
  if (!mapHint) return `${scriptUrl}.map`;
  if (mapHint.startsWith("data:")) return "";
  return new URL(mapHint, scriptUrl).toString();
}

export async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      "user-agent": "web-clone-skill/1.0 sourcemap-hunt",
      "accept": "*/*",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

// Fetch a bundle, follow its sourceMappingURL hint (or the `<script>.map`
// convention) and save the map; every failure is recorded on the entry.
async function huntScript(scriptUrl, outDir, deps) {
  const entry = { scriptUrl, status: "unknown", mapUrl: "", mapFile: "", error: "" };
  try {
    const js = await fetchText(deps.fetch, scriptUrl);
    const hint = js.match(/[#@]\s*sourceMappingURL=([^\s*]+)/)?.[1] || "";
    entry.mapUrl = resolveMapUrl(scriptUrl, hint);
    if (entry.mapUrl) {
      const mapText = await fetchText(deps.fetch, entry.mapUrl);
      const mapFile = path.join(outDir, fileNameFor(entry.mapUrl, ".map"));
      deps.fs.writeFileSync(mapFile, mapText);
      entry.mapFile = mapFile;
      entry.status = "ok";
    } else {
      entry.status = "inline-or-data-map";
    }
  } catch (error) {
    entry.status = "error";
    entry.error = error.message;
  }
  return entry;
}

async function hunt(args, deps) {
  const recon = JSON.parse(deps.fs.readFileSync(args.recon, "utf8"));
  const originHost = recon.url ? new URL(recon.url).hostname : "";
  const scripts = collectScripts(recon).filter((script) => args.allExternal || new URL(script).hostname === originHost);
  const outDir = path.resolve(args.outDir);
  deps.fs.mkdirSync(outDir, { recursive: true });

  const results = [];
  for (const scriptUrl of scripts) {
    results.push(await huntScript(scriptUrl, outDir, deps));
  }

  const manifest = {
    source: args.recon,
    url: recon.url,
    allExternal: args.allExternal,
    scriptCount: scripts.length,
    mapCount: results.filter((item) => item.status === "ok").length,
    results,
  };
  const manifestFile = path.join(outDir, "sourcemap-manifest.json");
  deps.fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  deps.log(manifestFile);
  return 0;
}

/**
 * CLI entry: hunt source maps for the bundles listed in a recon JSON.
 * @returns {Promise<number>} exit code (0 ok, 1 usage error or failure).
 */
export async function main(argv, deps = {}) {
  const io = { ...DEFAULT_DEPS, ...deps };
  return runCli("sourcemap-hunt", () => {
    const args = parseArgs(argv);
    if (args.help || !args.recon) {
      usage(io.log);
      return args.help ? 0 : 1;
    }
    return hunt(args, io);
  }, io.error);
}

await runIfMain(import.meta.url, main);
