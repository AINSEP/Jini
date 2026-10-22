import { speechChannels } from "./channels.js";
// Sandboxed Electron preloads have a restricted require polyfill. Bundle this bridge into the
// CommonJS preload so only Electron remains external; runtime package/sibling requires would fail.
// Expose a narrow bridge through context isolation rather than granting the page Node/Electron APIs.
import type { TranscriptionAvailability, TranscriptionResult } from "./transcription-port.js";
export interface SpeechRendererIpcPort { invoke(requiredArgs: { channel: string }, optionalArgs?: { args?: unknown[] }): Promise<unknown> }
export interface SpeechBridge {
  isAvailable(): Promise<TranscriptionAvailability>;
  transcribe(args: { samples: Float32Array | readonly number[]; sampleRate: number }): Promise<TranscriptionResult>;
}
/** Build a narrow renderer bridge. Bundle into sandboxed preloads before loading. */
export function createSpeechBridge({ ipcRenderer, channelNamespace }: { ipcRenderer: SpeechRendererIpcPort; channelNamespace: string }): SpeechBridge {
  const channels = speechChannels({ channelNamespace });
  return {
    isAvailable: () => ipcRenderer.invoke({ channel: channels.isAvailable }) as Promise<TranscriptionAvailability>,
    transcribe: ({ samples, sampleRate }) => ipcRenderer.invoke({ channel: channels.transcribe }, { args: [samples, sampleRate] }) as Promise<TranscriptionResult>,
  };
}
/** Expose only the speech capability under a caller-owned renderer global. */
export function exposeSpeechBridge({ contextBridge, ipcRenderer, channelNamespace, globalName }: {
  contextBridge: { exposeInMainWorld(args: { name: string; bridge: SpeechBridge }): void };
  ipcRenderer: SpeechRendererIpcPort; channelNamespace: string; globalName: string;
}): void {
  contextBridge.exposeInMainWorld({ name: globalName, bridge: createSpeechBridge({ ipcRenderer, channelNamespace }) });
}
