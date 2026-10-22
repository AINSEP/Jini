import { speechChannels } from "./channels.js";
export { speechChannels } from "./channels.js";
import type { TranscriptionPort } from "./transcription-port.js";
import { encodeMonoWav } from "./pcm-wav-encoder.js";
export const MAX_TRANSCRIBE_SAMPLES = 48_000 * 60 * 5;
// Five minutes at 48 kHz is 57.6 MB of float32 samples: generous for an utterance while bounding
// the main process's allocation, WAV encoding and recognizer input per renderer call.
// Electron can supply a null senderFrame after navigation/destruction; absence cannot confer trust.
export interface SpeechIpcEvent { senderFrame?: { url: string } | null }
export interface SpeechIpcPort {
  handle(args: { channel: string; handler: (args: { event: SpeechIpcEvent | undefined; samples?: unknown; sampleRate?: unknown }) => unknown }): unknown;
  removeHandler?(args: { channel: string }): unknown;
}
export interface SpeechIpcMessages {
  senderRefused: string; invalidRate: string; invalidSamples: string; missingSenderGuard: string;
  tooManySamples(args: { maxSamples: number }): string;
}
export interface RegisterSpeechIpcArgs {
  ipcMain: SpeechIpcPort; port: TranscriptionPort; channelNamespace: string;
  isTrustedSender: (args: { senderUrl: string }) => boolean; messages: SpeechIpcMessages;
}
function assertTrustedSender(event: SpeechIpcEvent | undefined, guard: (args: { senderUrl: string }) => boolean, message: string): void {
  const url = event?.senderFrame?.url;
  if (typeof url !== "string" || !guard({ senderUrl: url })) throw new Error(message);
}
function readSamples(samples: unknown, maxSamples: number, messages: SpeechIpcMessages): Float32Array {
  // Structured clone does not make input trustworthy. An array-like {length: 2_000_000_000}
  // once reached Float32Array.from and requested 8 GB; reject shape/length before copying anything.
  if (!(samples instanceof Float32Array) && !Array.isArray(samples)) throw new TypeError(messages.invalidSamples);
  if (samples.length > maxSamples) throw new RangeError(messages.tooManySamples({ maxSamples }));
  // Check every indexed element, including sparse holes, before allocating the converted array.
  for (let i = 0; i < samples.length; i += 1) {
    if (!Number.isFinite(samples[i])) throw new TypeError(messages.invalidSamples);
  }
  if (samples instanceof Float32Array) return samples;
  return Float32Array.from(samples as number[]);
}
/** Register trusted speech handlers; preserve positional IPC payloads and return a disposer. */
export function registerSpeechIpc({ ipcMain, port, channelNamespace, isTrustedSender, messages }: RegisterSpeechIpcArgs,
  { maxSamples = MAX_TRANSCRIBE_SAMPLES }: { maxSamples?: number } = {}): () => void {
  // A missing sender predicate must fail closed: a trust-all default silently exposes recognition
  // to every page with the preload. Register before opening windows so no bridge races setup.
  if (typeof isTrustedSender !== "function") throw new Error(messages.missingSenderGuard);
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 0) throw new RangeError(messages.tooManySamples({ maxSamples }));
  const channels = speechChannels({ channelNamespace });
  ipcMain.handle({ channel: channels.isAvailable, handler: ({ event }) => {
    assertTrustedSender(event, isTrustedSender, messages.senderRefused);
    return port.isAvailable();
  } });
  ipcMain.handle({ channel: channels.transcribe, handler: ({ event, samples, sampleRate }) => {
    assertTrustedSender(event, isTrustedSender, messages.senderRefused);
    if (!Number.isInteger(sampleRate) || (sampleRate as number) < 8_000 || (sampleRate as number) > 192_000) throw new RangeError(messages.invalidRate);
    // Carry the capture hardware's whole-Hz rate (telephone band through high-end interfaces);
    // forcing browser resampling to a fixed rate adds a failure mode without helping the WAV encoder.
    const wavBuffer = encodeMonoWav({ samples: readSamples(samples, maxSamples, messages), sampleRate: sampleRate as number });
    return port.transcribe({ wavBuffer });
  } });
  return () => { ipcMain.removeHandler?.({ channel: channels.isAvailable }); ipcMain.removeHandler?.({ channel: channels.transcribe }); };
}
