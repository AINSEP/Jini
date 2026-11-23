import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import { sniffContentType } from "../content-type-sniffer.js";
import { findVideoBinaries } from "../video-frames.ffmpeg.js";
import { buildVideoTranscodeArgs, createFfmpegMediaTranscoder } from "../video-transcode.ffmpeg.js";

const BINARIES = { nice: "/usr/bin/nice", ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" };
const directories: string[] = [];
async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "transcode-test-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

const mp4 = () => { const bytes = new Uint8Array(32); bytes.set([0, 0, 0, 16], 0); bytes.set(Buffer.from("ftypisom"), 4); return bytes; };

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
  const transcoder = createFfmpegMediaTranscoder({ tempDir: await tempDir(), findBinaries: async () => undefined, runProcess: async () => { throw new Error("must not run"); } });
  assert.deepEqual(await transcoder.transcode({ input: mp4(), target: "mp4-h264-aac-faststart" }),
    { ok: false, reason: "unavailable", message: "Video conversion needs ffmpeg on this computer." });
});

test("the ffmpeg transcoder runs ffmpeg at low priority on temp files and removes them afterwards", async () => {
  const root = await tempDir();
  const runs: Array<{ command: string; args: readonly string[]; timeoutMs: number }> = [];
  const transcoder = createFfmpegMediaTranscoder({
    tempDir: root, timeoutMs: 1234, findBinaries: async () => BINARIES,
    runProcess: async ({ command, args }, { timeoutMs }) => {
      runs.push({ command, args, timeoutMs });
      const input = args[args.indexOf("-i") + 1]!;
      assert.deepEqual([...await readFile(input)], [...mp4()]);
      await writeFile(args[args.length - 1]!, mp4());
      return new Uint8Array();
    },
  });
  const result = await transcoder.transcode({ input: mp4(), target: "mp4-h264-aac-faststart" });
  assert.deepEqual(result, { ok: true, bytes: new Uint8Array(mp4()) });
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.command, "/usr/bin/nice");
  assert.deepEqual(runs[0]!.args.slice(0, 3), ["-n", "19", "/usr/bin/ffmpeg"]);
  assert.equal(runs[0]!.timeoutMs, 1234);
  assert.deepEqual(await readdir(root), []);
});

test("the ffmpeg transcoder reports a timeout in plain words and still cleans up", async () => {
  const root = await tempDir();
  const transcoder = createFfmpegMediaTranscoder({
    tempDir: root, findBinaries: async () => BINARIES,
    runProcess: async () => { throw Object.assign(new Error("Video preview timed out."), { reason: "timeout" }); },
  });
  assert.deepEqual(await transcoder.transcode({ input: mp4(), target: "mp4-h264-aac-faststart" }),
    { ok: false, reason: "timeout", message: "Video conversion took too long and was stopped." });
  assert.deepEqual(await readdir(root), []);
});

test("the ffmpeg transcoder refuses output that is not an MP4", async () => {
  const transcoder = createFfmpegMediaTranscoder({
    tempDir: await tempDir(), findBinaries: async () => BINARIES,
    runProcess: async ({ args }) => { await writeFile(args[args.length - 1]!, Buffer.from("not a video")); return new Uint8Array(); },
  });
  const result = await transcoder.transcode({ input: mp4(), target: "mp4-h264-aac-faststart" });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "invalid");
});

test("the ffmpeg transcoder refuses an input over its maximum without running ffmpeg", async () => {
  const transcoder = createFfmpegMediaTranscoder({ tempDir: await tempDir(), maxInputBytes: 8, findBinaries: async () => BINARIES, runProcess: async () => { throw new Error("must not run"); } });
  const result = await transcoder.transcode({ input: mp4(), target: "mp4-h264-aac-faststart" });
  assert.equal(!result.ok && result.reason, "too-large");
});

test("the ffmpeg transcoder does not start when the signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const transcoder = createFfmpegMediaTranscoder({ tempDir: await tempDir(), findBinaries: async () => BINARIES, runProcess: async () => { throw new Error("must not run"); } });
  const result = await transcoder.transcode({ input: mp4(), target: "mp4-h264-aac-faststart" }, { signal: controller.signal });
  assert.equal(!result.ok && result.reason, "canceled");
});

// Real codec round trip; skipped on hosts without nice/ffmpeg/ffprobe.
const hasFfmpeg = existsSync("/usr/bin/ffmpeg") && existsSync("/usr/bin/ffprobe");
test.skipIf(!hasFfmpeg)("a real ffmpeg turns a QuickTime clip into a faststart MP4", async () => {
  const work = await tempDir();
  const source = join(work, "clip.mov");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "mpeg4", "-c:a", "pcm_s16le", "-f", "mov", source]);
  const binaries = await findVideoBinaries({}, {});
  assert.ok(binaries);
  const transcoder = createFfmpegMediaTranscoder({ tempDir: await tempDir(), timeoutMs: 60_000 });
  const result = await transcoder.transcode({ input: await readFile(source), target: "mp4-h264-aac-faststart" });
  assert.ok(result.ok, !result.ok ? result.message : "");
  assert.equal(sniffContentType({ bytes: result.bytes }), "video/mp4");
  const text = Buffer.from(result.bytes).toString("latin1");
  assert.ok(text.indexOf("moov") < text.indexOf("mdat"), "faststart puts the moov index before the media data");
  assert.ok(text.includes("avc1"), "video track is H.264");
  assert.ok(text.includes("mp4a"), "audio track is AAC");
}, 90_000);
