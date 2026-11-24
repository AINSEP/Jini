// Ported from the host app's native speech adapter tests with the modules; the host keeps its copies as the consumer check.
/** Contract checks for the native ports, which injected Jini-only fakes cannot exercise. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { onTestFinished, test } from "vitest";

import { createNativeMacTranscriptionPort, speechHelperSourcePath } from "../mac-on-device-transcriber.js";
import { buildDefaultTranscriptionPort, registerNativeSpeechIpc, MAX_TRANSCRIBE_SAMPLES, type NativeSpeechHost } from "../speech-ipc.js";

const HOST: NativeSpeechHost = {
  channelNamespace: "host:speech",
  messages: {
    senderRefused: "host:speech: refused",
    invalidRate: "host:speech: bad rate",
    invalidSamples: "host:speech: bad samples",
    missingSenderGuard: "host:speech: isTrustedSender is required",
    tooManySamples: ({ maxSamples }) => `host:speech: at most ${maxSamples}`,
  },
  transcriptionMessages: {
    unsupportedPlatform: ({ platform }) => `unsupported-platform:${platform}`,
    unavailable: ({ reason }) => `host speech: unavailable (${reason})`,
  },
  mac: {
    binaryPath: "/never/used/helper",
    messages: {
      compilerMissing: "swiftc-not-found: no Swift toolchain on this machine",
      compilerFailed: ({ stderr }) => `swiftc-failed: ${stderr}`,
      invalidOutput: ({ stdout }) => `host speech: non-JSON ${stdout}`,
      cannotTranscribe: ({ reason }) => `host speech: cannot (${reason})`,
      recognitionFailed: ({ reason }) => `host speech: failed (${reason})`,
    },
    tempFilePrefix: "host-speech-",
  },
};

function tempDir({ prefix }: { prefix: string }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("the native adapter passes WAV bytes and locale to its helper, names scratch audio with the host prefix and removes it",
  { skip: process.platform === "win32" }, async () => {
    const dir = tempDir({ prefix: "host-native-speech-" });
    const binaryPath = path.join(dir, "helper");
    const tracePath = path.join(dir, "trace.json");
    // A controlled executable speaks the helper protocol; no Swift build or OS recognition runs.
    fs.writeFileSync(binaryPath, `#!/usr/bin/env node
const fs = require('node:fs');
const [command, ...args] = process.argv.slice(2);
if (command === 'check') {
  if (args[0] !== 'en-US') process.exit(2);
  process.stdout.write(JSON.stringify({ available: true, reason: null }));
} else if (command === 'transcribe') {
  fs.writeFileSync(${JSON.stringify(tracePath)}, JSON.stringify({ args, bytes: [...fs.readFileSync(args[0])] }));
  process.stdout.write(JSON.stringify({ ok: true, text: 'adapter fixture', elapsedMs: 7 }));
} else process.exit(3);
`, { mode: 0o700 });
    // The injected binaryPath is honoured; fs, execFile, temp naming and locale stay on production paths.
    const port = buildDefaultTranscriptionPort({ platform: "darwin", host: { ...HOST, mac: { ...HOST.mac, binaryPath } } });
    assert.deepEqual(await port.isAvailable(), { available: true, reason: undefined });
    const wavBuffer = Buffer.from([82, 73, 70, 70, 0, 255]);
    assert.deepEqual(await port.transcribe({ wavBuffer }), { text: "adapter fixture", elapsedMs: 7 });
    const trace = JSON.parse(fs.readFileSync(tracePath, "utf8")) as { args: string[]; bytes: number[] };
    assert.deepEqual(trace.bytes, [...wavBuffer]);
    assert.equal(trace.args[1], "en-US");
    assert.match(path.basename(trace.args[0]!), /^host-speech-[0-9a-f-]{36}\.wav$/);
    assert.equal(path.dirname(trace.args[0]!), os.tmpdir());
    assert.equal(fs.existsSync(trace.args[0]!), false, "scratch recording must be removed");
  });

test("a cold native adapter creates its cache and reports compiler failure without recognition", async () => {
  const dir = tempDir({ prefix: "host-native-cache-" });
  const binaryPath = path.join(dir, "nested", "helper");
  const sourcePath = path.join(dir, "source.swift");
  const calls: unknown[] = [];
  const compilerFailure = Object.assign(new Error("compiler fixture"), { code: "ENOENT" });
  const port = createNativeMacTranscriptionPort({ ...HOST.mac, binaryPath }, {
    sourcePath,
    execFileAsync: async ({ file, args }) => {
      calls.push([file, args]);
      throw compilerFailure;
    },
  });
  assert.deepEqual(await port.isAvailable(), { available: false, reason: "swiftc-not-found: no Swift toolchain on this machine" });
  assert.deepEqual(calls, [["swiftc", ["-O", sourcePath, "-o", binaryPath]]]);
  assert.equal(fs.statSync(path.dirname(binaryPath)).isDirectory(), true);
  assert.equal(fs.existsSync(binaryPath), false);
});

test("the published Swift helper source resolves through the package's own export", () => {
  const sourcePath = speechHelperSourcePath({});
  assert.equal(path.basename(sourcePath), "speech-helper.swift");
  assert.match(fs.readFileSync(sourcePath, "utf8"), /requiresOnDeviceRecognition = true/);
});

test("unsupported default speech is unavailable with the host's wording and IPC disposal removes both native channels", async () => {
  const port = buildDefaultTranscriptionPort({ platform: "linux", host: HOST });
  assert.deepEqual(await port.isAvailable(), { available: false, reason: "unsupported-platform:linux" });
  await assert.rejects(port.transcribe({ wavBuffer: Buffer.alloc(0) }), /^Error: host speech: unavailable \(unsupported-platform:linux\)$/);
  const registered: string[] = [];
  const removed: string[] = [];
  const dispose = registerNativeSpeechIpc({
    ipcMain: { handle: (channel) => { registered.push(channel); }, removeHandler: (channel) => { removed.push(channel); } },
    isTrustedSender: () => true,
    host: HOST,
  }, { port });
  dispose();
  assert.deepEqual(registered, ["host:speech:isAvailable", "host:speech:transcribe"], "channels use the injected namespace");
  assert.deepEqual(removed, registered);
});

test("Electron's positional (event, samples, sampleRate) payload reaches the port; untrusted senders are refused first", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const seen: unknown[] = [];
  registerNativeSpeechIpc({
    ipcMain: { handle: (channel, fn) => { handlers.set(channel, fn as (...args: unknown[]) => unknown); } },
    isTrustedSender: ({ senderUrl }) => senderUrl === "app://ok/",
    host: HOST,
  }, { port: { isAvailable: async () => ({ available: true }), transcribe: async ({ wavBuffer }) => { seen.push(wavBuffer.length); return { text: "hi", elapsedMs: 1 }; } } });
  const transcribe = [...handlers.entries()].find(([channel]) => channel.endsWith("transcribe"))![1];
  assert.deepEqual(await transcribe({ senderFrame: { url: "app://ok/" } }, [0, 0.5], 16000), { text: "hi", elapsedMs: 1 });
  assert.equal(seen.length, 1);
  await assert.rejects(async () => transcribe({ senderFrame: { url: "https://evil/" } }, [0], 16000), /host:speech: refused/);
});

test("a missing sender guard fails before any default port is built, with the host's message", () => {
  assert.throws(() => registerNativeSpeechIpc({ ipcMain: { handle: () => undefined }, host: HOST } as never), /^Error: host:speech: isTrustedSender is required$/);
  assert.equal(MAX_TRANSCRIBE_SAMPLES, 48_000 * 60 * 5);
});
