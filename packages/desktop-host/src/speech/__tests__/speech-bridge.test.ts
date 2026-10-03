import { test } from "vitest";
import assert from "node:assert/strict";
import { createSpeechBridge, exposeSpeechBridge } from "../speech-bridge.js";
import { registerSpeechIpc, speechChannels } from "../speech-ipc.js";

test("two bridges use separate namespaces and preserve the existing positional IPC payload", async () => {
  const calls: unknown[][] = [];
  const ipcRenderer = { invoke: async ({ channel }: { channel: string }, { args = [] }: { args?: unknown[] } = {}) => { calls.push([channel, ...args]); return { text: "spoken", elapsedMs: 3 }; } };
  const a = createSpeechBridge({ ipcRenderer, channelNamespace: "a:speech" });
  const b = createSpeechBridge({ ipcRenderer, channelNamespace: "b:voice" });
  await a.isAvailable();
  assert.deepEqual(await b.transcribe({ samples: [0], sampleRate: 16000 }), { text: "spoken", elapsedMs: 3 });
  assert.deepEqual(calls, [["a:speech:isAvailable"], ["b:voice:transcribe", [0], 16000]]);
});

test("exposure publishes only speech under the caller's global name", () => {
  const exposed: unknown[][] = [];
  exposeSpeechBridge({ contextBridge: { exposeInMainWorld: ({ name, bridge }) => { exposed.push([name, Object.keys(bridge).sort()]); } }, ipcRenderer: { invoke: async () => ({}) }, channelNamespace: "host:voice", globalName: "hostVoice" });
  assert.deepEqual(exposed, [["hostVoice", ["isAvailable", "transcribe"]]]);
});

test("speech IPC disposes handlers and rejects sparse/non-finite input before transcription", () => {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const removed: string[] = [];
  let transcriptions = 0;
  const dispose = registerSpeechIpc({ ipcMain: { handle: ({ channel, handler }) => { handlers.set(channel, (event, samples, sampleRate) => handler({ event, samples, sampleRate })); }, removeHandler: ({ channel }) => removed.push(channel) }, port: { isAvailable: async () => ({ available: true }), transcribe: async () => { transcriptions++; return { text: "", elapsedMs: 0 }; } }, channelNamespace: "host:voice", isTrustedSender: ({ senderUrl }) => senderUrl === "app://trusted", messages: { senderRefused: "refused", invalidRate: "invalid rate", invalidSamples: "invalid samples", missingSenderGuard: "guard required", tooManySamples: ({ maxSamples }) => `limit ${maxSamples}` } }, { maxSamples: 3 });
  const handler = handlers.get(speechChannels({ channelNamespace: "host:voice" }).transcribe)!;
  for (const samples of [new Array(2), new Float32Array([NaN]), new Float32Array([Infinity])]) {
    assert.throws(() => handler({ senderFrame: { url: "app://trusted" } }, samples, 16000), /invalid samples/);
  }
  assert.equal(transcriptions, 0); dispose();
  assert.deepEqual(removed, ["host:voice:isAvailable", "host:voice:transcribe"]);
});
