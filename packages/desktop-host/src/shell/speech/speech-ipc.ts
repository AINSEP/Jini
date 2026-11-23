/**
 * Electron-native binding of `../../speech`'s IPC handlers: adapts Electron's positional
 * `ipcMain.handle(channel, (event, samples, sampleRate) => …)` to the package's object-argument
 * port and lazily builds the default transcription port (macOS on-device, else unavailable).
 * This is the one module that knows both "there is an Electron IPC channel" and "there is a
 * transcription port"; it has no recognition logic of its own.
 *
 * **Every call is validated before it costs anything.** The channels are reachable from every page
 * that runs a preload exposing the host's voice bridge — a site's admin AND its public pages, and
 * the host's home window. So the sender's page is checked first, then the sample rate, then the
 * samples' type and length, all before a single sample is copied. `samples` arrives by structured
 * clone, so `{ length: 2_000_000_000 }` crosses IPC in a few bytes; a naive
 * `Float32Array.from(samples)` then allocated 8 GB in the main process.
 *
 * Wiring: the host injects its IPC `channelNamespace` (shared with its preload bridge), all error
 * wording, and the macOS recognizer config; register once before any window opens.
 */
import {
  registerSpeechIpc as registerIpc, resolveTranscriptionPort, MAX_TRANSCRIBE_SAMPLES,
  type SpeechIpcEvent, type SpeechIpcMessages, type TranscriptionMessages, type TranscriptionPort,
} from "../../speech/index.js";
import type { MacTranscriberDeps } from "../../speech/macos/index.js";
import { createNativeMacTranscriptionPort, type NativeMacTranscriberConfig } from "./mac-on-device-transcriber.js";

export { MAX_TRANSCRIBE_SAMPLES };

/** Everything product-specific about the speech feature, owned by the host. */
export interface NativeSpeechHost {
  channelNamespace: string;
  messages: SpeechIpcMessages;
  transcriptionMessages: TranscriptionMessages;
  mac: NativeMacTranscriberConfig;
}

/** The slice of Electron's `ipcMain` used here, positional as Electron declares it. */
export interface NativeSpeechIpcMain {
  handle(channel: string, listener: (event: SpeechIpcEvent, ...args: unknown[]) => unknown): void;
  removeHandler?(channel: string): void;
}

/** Resolve a lazy host transcription port. @complexity O(1). */
export function buildDefaultTranscriptionPort({ platform, host }: { platform: string; host: Pick<NativeSpeechHost, "transcriptionMessages" | "mac"> },
  overrides: Partial<MacTranscriberDeps> = {}): TranscriptionPort {
  return resolveTranscriptionPort({ platform, messages: host.transcriptionMessages, createMacPort: () => createNativeMacTranscriptionPort(host.mac, overrides) });
}

/** Adapt native IPC without changing the renderer's positional payloads. @complexity O(1) to register; O(n) per recording. */
export function registerNativeSpeechIpc({ ipcMain, isTrustedSender, host }: {
  ipcMain: NativeSpeechIpcMain;
  isTrustedSender: (required: { senderUrl: string }) => boolean;
  host: NativeSpeechHost;
}, { port, maxSamples = MAX_TRANSCRIBE_SAMPLES, platform = process.platform }: {
  port?: TranscriptionPort; maxSamples?: number;
  /** Which platform's default port to build when `port` is omitted; defaults to this process's. */
  platform?: string;
} = {}): () => void {
  // Fail before constructing native dependencies when the host forgot its sender policy.
  if (typeof isTrustedSender !== "function") throw new Error(host.messages.missingSenderGuard);
  return registerIpc({
    channelNamespace: host.channelNamespace, messages: host.messages,
    port: port ?? buildDefaultTranscriptionPort({ platform, host }),
    isTrustedSender,
    ipcMain: {
      handle: ({ channel, handler }) => ipcMain.handle(channel, (event, samples, sampleRate) => handler({ event, samples, sampleRate })),
      removeHandler: ({ channel }) => ipcMain.removeHandler?.(channel),
    },
  }, { maxSamples });
}
