import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareInBrowser, imageDataUrl, main, parseArgs, scoreFromDiff } from "../visual-diff.mjs";
import { browserEnv, createFakeBrowser, createFakePage, createOutput, fakeDocument, playwrightPorts, tempDir } from "./fakes-wc2.mjs";

/**
 * A minimal 2D canvas: an RGBA buffer sized when the context is taken,
 * with fillRect (solid white), drawImage at (0, 0) from a fake image's
 * pixel function, get/create/putImageData, and toDataURL over the
 * last-put buffer.
 */
function fakeCanvas() {
  const canvas = { width: 0, height: 0 };
  canvas.getContext = () => {
    const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    const ctx = {
      fillStyle: "",
      fillRect: (x, y, w, h) => {
        expect(ctx.fillStyle).toBe("white");
        data.fill(255, 0, w * h * 4);
      },
      drawImage: (image) => {
        for (let y = 0; y < image.naturalHeight; y += 1) {
          for (let x = 0; x < image.naturalWidth; x += 1) data.set(image.pixel(x, y), (y * canvas.width + x) * 4);
        }
      },
      getImageData: () => ({ data: Uint8ClampedArray.from(data) }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (imageData) => {
        canvas.put = imageData;
      },
    };
    return ctx;
  };
  canvas.toDataURL = (type) => `data:${type};base64,${Buffer.from(canvas.put.data).toString("base64")}`;
  return canvas;
}

/** Image stand-in: `src` resolves against `registry` (url → {naturalWidth, naturalHeight, pixel}). */
function imageClass(registry) {
  return class FakeImage {
    set src(value) {
      queueMicrotask(() => {
        const spec = registry[value];
        if (!spec) return this.onerror();
        Object.assign(this, spec);
        return this.onload();
      });
    }
  };
}

function diffEnv(registry) {
  return browserEnv({ document: fakeDocument({ createElement: () => fakeCanvas() }), extra: { Image: imageClass(registry) } });
}

const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];
const RED = [255, 0, 0, 255];
// 2x1: black, white.
const original = { naturalWidth: 2, naturalHeight: 1, pixel: (x) => (x === 0 ? BLACK : WHITE) };
// 2x2: black, red / white, white.
const clone = { naturalWidth: 2, naturalHeight: 2, pixel: (x, y) => (y === 0 && x === 0 ? BLACK : y === 0 ? RED : WHITE) };

describe("parseArgs and helpers", () => {
  it("parses flags with defaults and rejects unknown ones", () => {
    expect(parseArgs(["--original", "a.png", "--clone", "b.png", "--threshold", "0.2", "--out"])).toEqual({
      original: "a.png",
      clone: "b.png",
      out: "visual-diff.json",
      diff: "",
      threshold: 0.2,
    });
    expect(parseArgs(["-h", "--diff", "d.png", "--threshold"])).toMatchObject({ help: true, diff: "d.png", threshold: 0.08 });
    expect(() => parseArgs(["--fast"])).toThrow("Unexpected argument: --fast");
  });

  it("imageDataUrl base64-encodes the file with a mime from its extension", () => {
    const dir = tempDir();
    for (const name of ["a.jpg", "b.JPEG", "c.png", "d"]) fs.writeFileSync(path.join(dir, name), "hi");
    expect(imageDataUrl(path.join(dir, "a.jpg"))).toBe("data:image/jpeg;base64,aGk=");
    expect(imageDataUrl(path.join(dir, "b.JPEG"))).toBe("data:image/jpeg;base64,aGk=");
    expect(imageDataUrl(path.join(dir, "c.png"))).toBe("data:image/png;base64,aGk=");
    expect(imageDataUrl(path.join(dir, "d"))).toBe("data:image/png;base64,aGk=");
  });

  it("scoreFromDiff maps (ratio, mean) into the 5 → 1 bands, requiring both limits", () => {
    expect(scoreFromDiff(0, 0)).toBe(5);
    expect(scoreFromDiff(0.01, 0.01)).toBe(5);
    expect(scoreFromDiff(0.04, 0.02)).toBe(4.5);
    expect(scoreFromDiff(0.005, 0.05)).toBe(4);
    expect(scoreFromDiff(0.16, 0.08)).toBe(3);
    expect(scoreFromDiff(0.3, 0.14)).toBe(2);
    expect(scoreFromDiff(0.31, 0)).toBe(1);
    expect(scoreFromDiff(0, 0.15)).toBe(1);
  });
});

describe("compareInBrowser", () => {
  it("compares on a white canvas sized to the larger image and paints a diff overlay", async () => {
    const page = createFakePage({ env: diffEnv({ A: original, B: clone }) });
    const result = await compareInBrowser(page, "A", "B", 0.08);
    expect(result).toMatchObject({
      original: { width: 2, height: 1 },
      clone: { width: 2, height: 2 },
      comparedCanvas: { width: 2, height: 2 },
      threshold: 0.08,
      changedPixels: 1,
      totalPixels: 4,
      diffPixelRatio: 0.25,
      meanAbsDiff: 0.125,
      rmse: 0.25,
    });
    const pixels = Array.from(Buffer.from(result.diffPngDataUrl.replace("data:image/png;base64,", ""), "base64"));
    // Unchanged pixels are a faded copy of the original; the changed one is red.
    expect(pixels).toEqual([184, 184, 184, 255, 255, 40, 40, 255, 248, 248, 248, 255, 248, 248, 248, 255]);
  });

  it("rejects when an image cannot be loaded", async () => {
    const page = createFakePage({ env: diffEnv({ A: original }) });
    await expect(compareInBrowser(page, "A", "data:image/png;base64,broken", 0.08)).rejects.toThrow("Failed to load image: data:image/png;base64,broken");
  });
});

describe("main", () => {
  it("prints usage: exit 0 for --help, 1 when an image is missing, 1 on a bad flag", async () => {
    const out = createOutput();
    expect(await main({ argv: ["--help"] }, out)).toBe(0);
    expect(await main({ argv: ["--original", "a.png"] }, out)).toBe(1);
    expect(await main({ argv: ["--x"] }, out)).toBe(1);
    expect(out.logs[0]).toContain("node scripts/visual-diff.mjs --original <png> --clone <png>");
    expect(out.errors).toEqual(["visual-diff failed: Unexpected argument: --x"]);
  });

  it("writes metrics JSON and the diff PNG for two screenshots", async () => {
    const dir = tempDir();
    const originalFile = path.join(dir, "original.png");
    const cloneFile = path.join(dir, "clone.png");
    fs.writeFileSync(originalFile, "original-bytes");
    fs.writeFileSync(cloneFile, "clone-bytes");
    const registry = { [imageDataUrl(originalFile)]: original, [imageDataUrl(cloneFile)]: clone };
    const browser = createFakeBrowser(() => createFakePage({ env: diffEnv(registry) }));
    const outFile = path.join(dir, "out", "visual-diff.json");
    const diffFile = path.join(dir, "diffs", "diff.png");
    const out = createOutput();

    expect(await main({ argv: ["--original", originalFile, "--clone", cloneFile, "--out", outFile, "--diff", diffFile] }, { ...out, ...playwrightPorts(browser) })).toBe(0);

    expect(out.logs).toEqual([outFile]);
    const result = JSON.parse(fs.readFileSync(outFile, "utf8"));
    expect(result).toMatchObject({ changedPixels: 1, totalPixels: 4, visualScore: 2, files: { original: originalFile, clone: cloneFile, diff: diffFile } });
    expect(result).not.toHaveProperty("diffPngDataUrl");
    expect(Array.from(fs.readFileSync(diffFile))).toEqual([184, 184, 184, 255, 255, 40, 40, 255, 248, 248, 248, 255, 248, 248, 248, 255]);
    expect(browser.closed).toBe(true);
  });

  it("omits the diff image when --diff is not given, and exits 1 when an image fails to load", async () => {
    const dir = tempDir();
    const a = path.join(dir, "a.png");
    fs.writeFileSync(a, "same");
    const browser = createFakeBrowser(() => createFakePage({ env: diffEnv({ [imageDataUrl(a)]: original }) }));
    const outFile = path.join(dir, "same.json");
    const out = createOutput();
    expect(await main({ argv: ["--original", a, "--clone", a, "--out", outFile] }, { ...out, ...playwrightPorts(browser) })).toBe(0);
    const result = JSON.parse(fs.readFileSync(outFile, "utf8"));
    expect(result).toMatchObject({ changedPixels: 0, visualScore: 5, files: { diff: "" } });
    expect(fs.readdirSync(dir).sort()).toEqual(["a.png", "same.json"]);

    const broken = createFakeBrowser(() => createFakePage({ env: diffEnv({}) }));
    expect(await main({ argv: ["--original", a, "--clone", a, "--out", outFile] }, { ...out, ...playwrightPorts(broken) })).toBe(1);
    expect(out.errors).toEqual([`visual-diff failed: Failed to load image: ${imageDataUrl(a).slice(0, 80)}`]);
  });

  it("fails with exit 1 when a screenshot file is missing", async () => {
    const out = createOutput();
    const browser = createFakeBrowser(() => createFakePage({ env: diffEnv({}) }));
    expect(await main({ argv: ["--original", path.join(tempDir(), "no.png"), "--clone", "x.png"] }, { ...out, ...playwrightPorts(browser) })).toBe(1);
    expect(out.errors[0]).toMatch(/^visual-diff failed: ENOENT/);
  });
});
