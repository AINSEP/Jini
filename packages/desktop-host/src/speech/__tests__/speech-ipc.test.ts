import { registerSpeechIpc as register, MAX_TRANSCRIBE_SAMPLES } from "../speech-ipc.js";
const channelNamespace = "sample:speech";
const IPC_CHANNEL_IS_AVAILABLE = `${channelNamespace}:isAvailable`;
const IPC_CHANNEL_TRANSCRIBE = `${channelNamespace}:transcribe`;
const messages = {
  senderRefused: "sample:speech: refused — the sender is not a page this app serves.",
  invalidRate: "sample:speech:transcribe: sampleRate must be a whole number of Hz from 8000 to 192000.",
  invalidSamples: "sample:speech:transcribe: samples must be a Float32Array or an array of finite numbers.",
  tooManySamples: ({ maxSamples }: { maxSamples: number }) => `sample:speech:transcribe: at most ${maxSamples} samples per recording.`,
  missingSenderGuard: "isTrustedSender is required",
};
type OldArgs = { ipcMain: Parameters<typeof register>[0]["ipcMain"]; port: { isAvailable(): Promise<import("../transcription-port.js").TranscriptionAvailability>; transcribe(wavBuffer: Buffer): Promise<import("../transcription-port.js").TranscriptionResult> }; isTrustedSender: (url: string) => boolean; maxSamples?: number };
const registerSpeechIpc = ({ maxSamples, port, isTrustedSender, ...args }: OldArgs) => register({ ...args, isTrustedSender: typeof isTrustedSender === "function" ? ({ senderUrl }) => isTrustedSender(senderUrl) : isTrustedSender, channelNamespace, messages, port: { isAvailable: () => port.isAvailable(), transcribe: ({ wavBuffer }) => port.transcribe(wavBuffer) } }, maxSamples === undefined ? {} : { maxSamples });
/**
 * @file Direct tests for `speech-ipc.ts`. No real Electron `ipcMain` — a tiny fake that records
 * `handle(channel, fn)` registrations and lets the test invoke them directly, plus an injected
 * fake port so no real recognizer or filesystem is touched.
 */
import { test } from "vitest";
import assert from "node:assert/strict";


/** A handler as the fake records it, called with whatever the renderer would send. */
type RecordedHandler = (...args: any[]) => unknown; // any: Electron's own IpcMain listener signature; IPC hands a handler its arguments untyped

/** The page every test below calls from, unless it is testing the sender check itself. */
const TRUSTED_URL = "http://127.0.0.1:4567/admin/";
const TRUSTED_EVENT = { senderFrame: { url: TRUSTED_URL } };
const isTrustedSender = (url: string) => url === TRUSTED_URL;

function fakeIpcMain() {
  const handlers = new Map<string, RecordedHandler>();
  return {
    handlers,
    handle: ({ channel, handler }: Parameters<import("../speech-ipc.js").SpeechIpcPort["handle"]>[0]) => handlers.set(channel, (event, samples, sampleRate) => handler({ event, samples, sampleRate })),
  };
}

test("registerSpeechIpc registers both channels", () => {
  const ipcMain = fakeIpcMain();
  registerSpeechIpc({ ipcMain, isTrustedSender, port: { isAvailable: async () => ({ available: true }), transcribe: async () => ({ text: "", elapsedMs: 0 }) } });
  assert.equal(typeof ipcMain.handlers.get(IPC_CHANNEL_IS_AVAILABLE), "function");
  assert.equal(typeof ipcMain.handlers.get(IPC_CHANNEL_TRANSCRIBE), "function");
});

test("the isAvailable handler relays the injected port's result verbatim", async () => {
  const ipcMain = fakeIpcMain();
  const port = { isAvailable: async () => ({ available: false, reason: "on-device-recognition-unavailable" }), transcribe: async () => assert.fail() };
  registerSpeechIpc({ ipcMain, port, isTrustedSender });

  const result = await ipcMain.handlers.get(IPC_CHANNEL_IS_AVAILABLE)!(TRUSTED_EVENT);
  assert.deepEqual(result, { available: false, reason: "on-device-recognition-unavailable" });
});

test("the transcribe handler encodes the incoming samples to WAV before handing them to the port", async () => {
  const ipcMain = fakeIpcMain();
  let receivedWav: Buffer | undefined;
  const port = {
    isAvailable: async () => assert.fail(),
    transcribe: async (wavBuffer: Buffer) => {
      receivedWav = wavBuffer;
      return { text: "ok", elapsedMs: 10 };
    },
  };
  registerSpeechIpc({ ipcMain, port, isTrustedSender });

  const result = await ipcMain.handlers.get(IPC_CHANNEL_TRANSCRIBE)!(TRUSTED_EVENT, [0, 0.5, -0.5], 16000);

  assert.deepEqual(result, { text: "ok", elapsedMs: 10 });
  // 44-byte WAV header + 3 samples * 2 bytes each.
  assert.equal(receivedWav!.length, 44 + 6);
  assert.equal(receivedWav!.toString("ascii", 0, 4), "RIFF");
  for (const sampleRate of [16000, 48000]) {
    await ipcMain.handlers.get(IPC_CHANNEL_TRANSCRIBE)!(TRUSTED_EVENT, [0, 0.5, -0.5], sampleRate);
    assert.equal(receivedWav!.readUInt32LE(24), sampleRate);
    assert.equal(receivedWav!.readUInt32LE(28), sampleRate * 2);
    assert.deepEqual([0, 1, 2].map((index) => receivedWav!.readInt16LE(44 + index * 2)), [0, 16383, -16384]);
  }
});

test("a rejected transcribe from the port propagates to the IPC caller rather than being swallowed", async () => {
  const ipcMain = fakeIpcMain();
  const port = { isAvailable: async () => assert.fail(), transcribe: async () => { throw new Error("recognition failed"); } };
  registerSpeechIpc({ ipcMain, port, isTrustedSender });

  await assert.rejects(async () => ipcMain.handlers.get(IPC_CHANNEL_TRANSCRIBE)!(TRUSTED_EVENT, [0], 16000), /recognition failed/);
});

/** Registers against a port that records every call, so a test can prove a refusal reached nothing. */
function registerRecording(options: { maxSamples?: number } = {}) {
  const ipcMain = fakeIpcMain();
  const calls: string[] = [];
  const port = {
    isAvailable: async () => {
      calls.push("isAvailable");
      return { available: true };
    },
    transcribe: async (wavBuffer: Buffer) => {
      calls.push(`transcribe:${wavBuffer.length}`);
      return { text: "ok", elapsedMs: 1 };
    },
  };
  registerSpeechIpc({ ipcMain, port, isTrustedSender, ...options });
  const transcribe = (event: unknown, samples: unknown, sampleRate: unknown) => ipcMain.handlers.get(IPC_CHANNEL_TRANSCRIBE)!(event, samples, sampleRate);
  const isAvailable = (event: unknown) => ipcMain.handlers.get(IPC_CHANNEL_IS_AVAILABLE)!(event);
  return { calls, transcribe, isAvailable };
}

const SENDER_REFUSED = /^Error: sample:speech: refused — the sender is not a page this app serves\.$/;
const RATE_REFUSED = /^RangeError: sample:speech:transcribe: sampleRate must be a whole number of Hz from 8000 to 192000\.$/;
const SAMPLES_REFUSED = /^TypeError: sample:speech:transcribe: samples must be a Float32Array or an array of finite numbers\.$/;

/** `assert.rejects` with the error's exact `Name: message` text. The call is wrapped in an async
 *  function because Electron's `ipcMain.handle` turns a handler's synchronous throw into a rejected
 *  `invoke`, and that is the contract the renderer sees. */
async function rejectsWith(call: () => unknown, pattern: RegExp) {
  await assert.rejects(async () => call(), (error: Error) => {
    assert.match(`${error.name}: ${error.message}`, pattern);
    return true;
  });
}

test("registerSpeechIpc refuses to register without a sender check, rather than trusting every page", () => {
  const port = { isAvailable: async () => assert.fail(), transcribe: async () => assert.fail() };
  // @ts-expect-error -- no isTrustedSender: the type rejects it, and this asserts the runtime does too.
  assert.throws(() => registerSpeechIpc({ ipcMain: fakeIpcMain(), port }), /isTrustedSender is required/);
});

test("both channels refuse a sender whose page this app does not serve, before reaching the port", async () => {
  const { calls, transcribe, isAvailable } = registerRecording();
  const foreign = { senderFrame: { url: "https://evil.example/admin/" } };
  await rejectsWith(() => transcribe(foreign, [0], 16000), SENDER_REFUSED);
  await rejectsWith(() => isAvailable(foreign), SENDER_REFUSED);
  // A frame that is gone (Electron reports `senderFrame` as null) or an event with no frame at all.
  await rejectsWith(() => transcribe({ senderFrame: null }, [0], 16000), SENDER_REFUSED);
  await rejectsWith(() => transcribe({}, [0], 16000), SENDER_REFUSED);
  await rejectsWith(() => isAvailable(undefined), SENDER_REFUSED);
  assert.deepEqual(calls, []);
});

test("the sender check sees the sending frame's url, exactly", async () => {
  const ipcMain = fakeIpcMain();
  const seen: string[] = [];
  const port = { isAvailable: async () => ({ available: true }), transcribe: async () => assert.fail() };
  registerSpeechIpc({ ipcMain, port, isTrustedSender: (url: string) => (seen.push(url), true) });
  await ipcMain.handlers.get(IPC_CHANNEL_IS_AVAILABLE)!({ senderFrame: { url: "http://127.0.0.1:9/admin/x?y=1" } });
  assert.deepEqual(seen, ["http://127.0.0.1:9/admin/x?y=1"]);
});

test("a nonsensical sample rate is refused before any samples are read", async () => {
  const { calls, transcribe } = registerRecording();
  const samples = [0];
  let reads = 0;
  Object.defineProperty(samples, 0, { get: () => { reads++; throw new Error('samples read before rate validation'); } });
  for (const sampleRate of [Number.NaN, 0, -48000, 7999, 192001, 44100.5, Number.POSITIVE_INFINITY, "48000", undefined]) {
    await rejectsWith(() => transcribe(TRUSTED_EVENT, samples, sampleRate), RATE_REFUSED);
  }
  assert.equal(reads, 0);
  assert.deepEqual(calls, []);
});

test("sample rates at both ends of the range, and the common ones, are accepted", async () => {
  const { calls, transcribe } = registerRecording();
  for (const sampleRate of [8000, 16000, 44100, 48000, 192000]) {
    assert.deepEqual(await transcribe(TRUSTED_EVENT, [0], sampleRate), { text: "ok", elapsedMs: 1 });
  }
  assert.equal(calls.length, 5);
});

test("samples that are not a Float32Array or an array of finite numbers are refused", async () => {
  const { calls, transcribe } = registerRecording();
  const refused = [[0, "0.5"], [0, Number.NaN], [0, Number.POSITIVE_INFINITY], [0, null], new Float64Array(2), new Int16Array(2), "0,0", { 0: 0, length: 1 }, null, undefined, 3];
  for (const samples of refused) {
    await rejectsWith(() => transcribe(TRUSTED_EVENT, samples, 16000), SAMPLES_REFUSED);
  }
  assert.deepEqual(calls, []);
});

test("the default cap is five minutes at 48 kHz", () => {
  assert.equal(MAX_TRANSCRIBE_SAMPLES, 48_000 * 60 * 5);
});

test("an array-like claiming more samples than the cap is refused before anything is allocated for it", async () => {
  // Structured clone carries `{ length: N }` across IPC in a few bytes, and `Float32Array.from`
  // then allocated N * 4 bytes in main. Refused on its length alone, never copied.
  const { calls, transcribe } = registerRecording();
  await rejectsWith(() => transcribe(TRUSTED_EVENT, { length: 14_400_001 }, 16000), SAMPLES_REFUSED);
  const tooLong: number[] = [];
  tooLong.length = 14_400_001;
  await rejectsWith(() => transcribe(TRUSTED_EVENT, tooLong, 16000), /^RangeError: sample:speech:transcribe: at most 14400000 samples per recording\.$/);
  assert.deepEqual(calls, []);
});

test("a recording of exactly the cap is accepted, and one sample more is refused, for both input shapes", async () => {
  const { calls, transcribe } = registerRecording({ maxSamples: 4 });
  const tooMany = /^RangeError: sample:speech:transcribe: at most 4 samples per recording\.$/;
  assert.deepEqual(await transcribe(TRUSTED_EVENT, new Float32Array(4), 16000), { text: "ok", elapsedMs: 1 });
  assert.deepEqual(await transcribe(TRUSTED_EVENT, [0, 0, 0, 0], 16000), { text: "ok", elapsedMs: 1 });
  await rejectsWith(() => transcribe(TRUSTED_EVENT, new Float32Array(5), 16000), tooMany);
  await rejectsWith(() => transcribe(TRUSTED_EVENT, [0, 0, 0, 0, 0], 16000), tooMany);
  // 44-byte WAV header + 4 samples * 2 bytes, twice.
  assert.deepEqual(calls, ["transcribe:52", "transcribe:52"]);
});
