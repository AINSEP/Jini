#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadPlaywright, launchChromium } from "./lib/playwright-loader.mjs";
import { HELP_OPTIONS, num, parseCliArgs, text } from "./lib/cli-args.mjs";
import { runCli, runIfMain } from "./lib/main-guard.mjs";

// fs / Playwright / output are ports with real defaults wired here at the CLI edge.
const DEFAULT_DEPS = { fs, loadPlaywright, launchChromium, log: console.log, error: console.error };

export function usage(log = console.log) {
  log(`Usage:
  node scripts/visual-diff.mjs --original <png> --clone <png> --out visual-diff.json [--diff visual-diff.png] [--threshold 0.08]

Compares screenshots in a real browser canvas and outputs numeric visual-diff metrics.
`);
}

const ARG_SPEC = {
  defaults: { original: "", clone: "", out: "visual-diff.json", diff: "", threshold: 0.08 },
  options: {
    ...HELP_OPTIONS,
    "--original": { key: "original", parse: text("") },
    "--clone": { key: "clone", parse: text("") },
    "--out": { key: "out", parse: text("visual-diff.json") },
    "--diff": { key: "diff", parse: text("") },
    "--threshold": { key: "threshold", parse: num("0.08") },
  },
};

export function parseArgs(argv) {
  return parseCliArgs({ argv, ...ARG_SPEC });
}

export function imageDataUrl(file, fsPort = fs) {
  const ext = path.extname(file).slice(1).toLowerCase() || "png";
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${fsPort.readFileSync(file).toString("base64")}`;
}

// [max diff-pixel ratio, max mean abs diff, score], best band first; a diff
// within both limits of a band earns its score, anything worse scores 1.
const SCORE_BANDS = [
  [0.01, 0.01, 5],
  [0.04, 0.025, 4.5],
  [0.08, 0.05, 4],
  [0.16, 0.08, 3],
  [0.3, 0.14, 2],
];

export function scoreFromDiff(diffRatio, meanAbsDiff) {
  const band = SCORE_BANDS.find(([maxRatio, maxMean]) => diffRatio <= maxRatio && meanAbsDiff <= maxMean);
  return band ? band[2] : 1;
}

export async function compareInBrowser(page, original, clone, threshold) {
  return page.evaluate(async ({ original, clone, threshold }) => {
    const loadImage = (src) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 80)}`));
      image.src = src;
    });

    const [left, right] = await Promise.all([loadImage(original), loadImage(clone)]);
    const width = Math.max(left.naturalWidth, right.naturalWidth);
    const height = Math.max(left.naturalHeight, right.naturalHeight);

    const canvasA = document.createElement("canvas");
    const canvasB = document.createElement("canvas");
    const canvasD = document.createElement("canvas");
    for (const canvas of [canvasA, canvasB, canvasD]) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctxA = canvasA.getContext("2d");
    const ctxB = canvasB.getContext("2d");
    const ctxD = canvasD.getContext("2d");
    ctxA.fillStyle = "white";
    ctxB.fillStyle = "white";
    ctxA.fillRect(0, 0, width, height);
    ctxB.fillRect(0, 0, width, height);
    ctxA.drawImage(left, 0, 0);
    ctxB.drawImage(right, 0, 0);

    const a = ctxA.getImageData(0, 0, width, height);
    const b = ctxB.getImageData(0, 0, width, height);
    const d = ctxD.createImageData(width, height);
    let changed = 0;
    let sumAbs = 0;
    let sumSq = 0;

    for (let i = 0; i < a.data.length; i += 4) {
      const dr = Math.abs(a.data[i] - b.data[i]);
      const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
      const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
      const da = Math.abs(a.data[i + 3] - b.data[i + 3]);
      const delta = (dr + dg + db + da) / 1020;
      sumAbs += delta;
      sumSq += delta * delta;
      if (delta > threshold) changed += 1;

      if (delta > threshold) {
        d.data[i] = 255;
        d.data[i + 1] = Math.max(0, 80 - delta * 80);
        d.data[i + 2] = Math.max(0, 80 - delta * 80);
        d.data[i + 3] = 255;
      } else {
        d.data[i] = Math.round(a.data[i] * 0.25 + 245 * 0.75);
        d.data[i + 1] = Math.round(a.data[i + 1] * 0.25 + 245 * 0.75);
        d.data[i + 2] = Math.round(a.data[i + 2] * 0.25 + 245 * 0.75);
        d.data[i + 3] = 255;
      }
    }

    ctxD.putImageData(d, 0, 0);
    const pixels = width * height;
    const diffPixelRatio = changed / pixels;
    const meanAbsDiff = sumAbs / pixels;
    const rmse = Math.sqrt(sumSq / pixels);

    return {
      original: { width: left.naturalWidth, height: left.naturalHeight },
      clone: { width: right.naturalWidth, height: right.naturalHeight },
      comparedCanvas: { width, height },
      threshold,
      changedPixels: changed,
      totalPixels: pixels,
      diffPixelRatio,
      meanAbsDiff,
      rmse,
      diffPngDataUrl: canvasD.toDataURL("image/png"),
    };
  }, { original, clone, threshold });
}

function writeDiffPng(file, diffDataUrl, fsPort) {
  const base64 = diffDataUrl.replace(/^data:image\/png;base64,/, "");
  fsPort.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fsPort.writeFileSync(file, Buffer.from(base64, "base64"));
}

async function visualDiff(args, deps) {
  const { chromium } = deps.loadPlaywright();
  const browser = await deps.launchChromium(chromium);
  const page = await browser.newPage();
  const result = await compareInBrowser(page, imageDataUrl(args.original, deps.fs), imageDataUrl(args.clone, deps.fs), args.threshold);
  await browser.close();

  const diffDataUrl = result.diffPngDataUrl;
  delete result.diffPngDataUrl;
  result.visualScore = scoreFromDiff(result.diffPixelRatio, result.meanAbsDiff);
  result.files = {
    original: path.resolve(args.original),
    clone: path.resolve(args.clone),
    diff: args.diff ? path.resolve(args.diff) : "",
  };

  deps.fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  deps.fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);
  if (args.diff) writeDiffPng(args.diff, diffDataUrl, deps.fs);

  deps.log(path.resolve(args.out));
  return 0;
}

/**
 * CLI entry: compare two screenshots, write metrics JSON (+ optional diff PNG).
 * @returns {Promise<number>} exit code (0 ok, 1 usage error or failure).
 */
export async function main({ argv }, deps = {}) {
  const io = { ...DEFAULT_DEPS, ...deps };
  return runCli({ label: "visual-diff", body: () => {
    const args = parseArgs(argv);
    if (args.help || !args.original || !args.clone) {
      usage(io.log);
      return args.help ? 0 : 1;
    }
    return visualDiff(args, io);
  }, report: io.error });
}

await runIfMain({ moduleUrl: import.meta.url, main });
