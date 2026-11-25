import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import { buildVideoTranscodeArgs, createFfmpegMediaTranscoder, type VideoBinaryFinder, type VideoProcessRunner } from "../adapter.js";

const BINARIES = { nice: "/usr/bin/nice", ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" };
const MESSAGES = {
  unavailable: "Video conversion needs ffmpeg on this computer.",
  busy: "Another video is being converted right now. Try again when it finishes.",
  "too-large": "This video is too large to convert.",
  timeout: "Video conversion took too long and was stopped.",
  canceled: "Video conversion was canceled.",
  invalid: "This video could not be converted. The file may be damaged or in a format that cannot be read.",
};
const directories: string[] = [];
async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "transcode-test-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

const mp4 = () => { const bytes = new Uint8Array(32); bytes.set([0, 0, 0, 16], 0); bytes.set(Buffer.from("ftypisom"), 4); return bytes; };
// A stand-in for the host's byte sniffer: only the ftyp box counts as MP4, so no CMS code is needed here.
const sniffContentType = ({ bytes }: { bytes: Uint8Array }): string | undefined =>
  Buffer.from(bytes.subarray(4, 8)).toString("latin1") === "ftyp" ? "video/mp4" : undefined;
const noRun: VideoProcessRunner = async () => { throw new Error("must not run"); };
const lockOf = (free = true) => ({ tryAcquire: () => (free ? () => undefined : undefined) });

function deps(overrides: Partial<Parameters<typeof createFfmpegMediaTranscoder>[0]> = {}): Parameters<typeof createFfmpegMediaTranscoder>[0] {
  return {
    findBinaries: async () => BINARIES, runProcess: noRun, lock: lockOf(), sniffContentType,
    maxInputBytes: 1024, messages: MESSAGES, env: { PATH: "/usr/bin" }, ...overrides,
  };
}
const request = { input: mp4(), target: "mp4-h264-aac-faststart" } as const;

test("buildVideoTranscodeArgs produces the exact web-safe H.264/AAC faststart argument list", () => {
  assert.deepEqual(buildVideoTranscodeArgs({ input: "/w/input", output: "/w/output.mp4", maxOutputBytes: 1000 }), [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
    "-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm",
    "-i", "/w/input",
    "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", "8M", "-bufsize", "16M",
    "-vf", "scale='min(1920,iw)':-2", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart", "-fs", "1000", "-f", "mp4", "/w/output.mp4",
  ]);
});

test("the ffmpeg transcoder says in plain words that ffmpeg is needed when it is missing", async () => {
  const transcoder = createFfmpegMediaTranscoder(deps({ findBinaries: async () => undefined }), { tempDir: await tempDir() });
  assert.deepEqual(await transcoder.transcode(request), { ok: false, reason: "unavailable", message: MESSAGES.unavailable });
});

test("an unavailable local binary returns a typed refusal without touching storage", async () => {
  const scratchParent = await tempDir();
  const tempRoot = join(scratchParent, "never-created");
  const discoveryCalls: unknown[] = [];
  const findBinaries: VideoBinaryFinder = async (required, optional) => { discoveryCalls.push(optional); return undefined; };
  const transcoder = createFfmpegMediaTranscoder(deps({ findBinaries, runProcess: noRun }), { tempDir: tempRoot });
  const result = await transcoder.transcode(request);
  assert.deepEqual(result, { ok: false, reason: "unavailable", message: MESSAGES.unavailable });
  assert.deepEqual(discoveryCalls, [{ env: { PATH: "/usr/bin" } }], "discovery ran once with the injected environment");
  assert.equal(existsSync(tempRoot), false, "no scratch directory was created");
});

test("the ffmpeg transcoder runs ffmpeg at low priority on temp files and removes them afterwards", async () => {
  const root = await tempDir();
  const runs: Array<{ command: string; args: readonly string[]; timeoutMs: number }> = [];
  const runProcess: VideoProcessRunner = async ({ command, args }, { timeoutMs }) => {
    runs.push({ command, args, timeoutMs });
    const input = args[args.indexOf("-i") + 1]!;
    assert.deepEqual([...await readFile(input)], [...mp4()]);
    await writeFile(args[args.length - 1]!, mp4());
    return new Uint8Array();
  };
  const transcoder = createFfmpegMediaTranscoder(deps({ runProcess }), { tempDir: root, timeoutMs: 1234 });
  assert.deepEqual(await transcoder.transcode(request), { ok: true, bytes: new Uint8Array(mp4()) });
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.command, "/usr/bin/nice");
  assert.deepEqual(runs[0]!.args.slice(0, 3), ["-n", "19", "/usr/bin/ffmpeg"]);
  assert.equal(runs[0]!.timeoutMs, 1234);
  assert.deepEqual(await readdir(root), []);
});

test("aborting conversion stops the process and removes the private temp directory", async () => {
  const root = await tempDir();
  const controller = new AbortController();
  let started!: () => void;
  const running = new Promise<void>(resolve => { started = resolve; });
  // Stands in for the real runner: it only stops when the signal it was handed is aborted.
  const runProcess: VideoProcessRunner = async (_command, { signal }) => {
    if (!signal) throw new Error("the cancel signal was not forwarded to the process");
    started();
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    throw Object.assign(new Error("stopped"), { reason: "canceled" });
  };
  const transcoder = createFfmpegMediaTranscoder(deps({ runProcess }), { tempDir: root });
  const pending = transcoder.transcode(request, { signal: controller.signal });
  await running;
  assert.deepEqual(await readdir(root).then(names => names.length), 1, "a private scratch folder exists while ffmpeg runs");
  controller.abort();
  assert.deepEqual(await pending, { ok: false, reason: "canceled", message: MESSAGES.canceled });
  assert.deepEqual(await readdir(root), []);
});

test("the ffmpeg transcoder reports a timeout in plain words and still cleans up", async () => {
  const root = await tempDir();
  const runProcess: VideoProcessRunner = async () => { throw Object.assign(new Error("Video preview timed out."), { reason: "timeout" }); };
  const transcoder = createFfmpegMediaTranscoder(deps({ runProcess }), { tempDir: root });
  assert.deepEqual(await transcoder.transcode(request), { ok: false, reason: "timeout", message: MESSAGES.timeout });
  assert.deepEqual(await readdir(root), []);
});

test("the ffmpeg transcoder refuses output that is not an MP4", async () => {
  const runProcess: VideoProcessRunner = async ({ args }) => { await writeFile(args[args.length - 1]!, Buffer.from("not a video")); return new Uint8Array(); };
  const transcoder = createFfmpegMediaTranscoder(deps({ runProcess }), { tempDir: await tempDir() });
  const result = await transcoder.transcode(request);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "invalid");
});

test("an oversized or non-MP4 output never reaches the media writer", async () => {
  const outputs = [
    { name: "oversized", bytes: (() => { const big = new Uint8Array(64); big.set(mp4(), 0); return big; })(), reason: "too-large" },
    { name: "non-MP4", bytes: new Uint8Array(Buffer.from("not a video at all, but small")), reason: "invalid" },
  ];
  for (const { name, bytes, reason } of outputs) {
    const root = await tempDir();
    const runProcess: VideoProcessRunner = async ({ args }) => { await writeFile(args[args.length - 1]!, bytes); return new Uint8Array(); };
    const transcoder = createFfmpegMediaTranscoder(deps({ runProcess }), { tempDir: root });
    const result = await transcoder.transcode(request, { maxOutputBytes: 48 });
    assert.equal(result.ok, false, name);
    assert.equal(!result.ok && result.reason, reason, name);
    assert.deepEqual(await readdir(root), [], `${name}: scratch removed`);
  }
});

test("the ffmpeg transcoder refuses an input over its maximum without running ffmpeg", async () => {
  const transcoder = createFfmpegMediaTranscoder(deps({ maxInputBytes: 8 }), { tempDir: await tempDir() });
  const result = await transcoder.transcode(request);
  assert.equal(!result.ok && result.reason, "too-large");
});

test("the ffmpeg transcoder does not start when the signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const transcoder = createFfmpegMediaTranscoder(deps(), { tempDir: await tempDir() });
  const result = await transcoder.transcode(request, { signal: controller.signal });
  assert.equal(!result.ok && result.reason, "canceled");
});

test("a busy lock returns the busy refusal before any scratch folder is made", async () => {
  const tempRoot = join(await tempDir(), "never-created");
  const transcoder = createFfmpegMediaTranscoder(deps({ lock: lockOf(false) }), { tempDir: tempRoot });
  assert.deepEqual(await transcoder.transcode(request), { ok: false, reason: "busy", message: MESSAGES.busy });
  assert.equal(existsSync(tempRoot), false);
});
