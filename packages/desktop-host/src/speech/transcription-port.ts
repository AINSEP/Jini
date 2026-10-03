/** The recognizer is swappable without coupling IPC handlers or composer UI to a native backend.
 * Platform selection is injected so capability policy can be checked without native I/O. */
/** Successful recognition of silence returns empty text, never null; elapsedMs supports latency logs. */
export interface TranscriptionResult { text: string; elapsedMs: number }
export interface TranscriptionAvailability { available: boolean; reason?: string | undefined }
export interface TranscriptionPort {
  /** Probe capability without capturing audio or prompting for authorization. */
  isAvailable(): Promise<TranscriptionAvailability>;
  /** Transcribe one complete WAV; implementations must not silently fall back to the network. */
  transcribe(args: { wavBuffer: Buffer }): Promise<TranscriptionResult>;
}
export interface TranscriptionMessages {
  unsupportedPlatform(args: { platform: string }): string;
  unavailable(args: { reason: string }): string;
}
export interface ResolveTranscriptionPortDeps {
  platform: string; createMacPort: () => TranscriptionPort; messages: TranscriptionMessages;
}
/** Return a port that reports a host-owned reason and rejects transcription. */
export function unavailablePort({ reason, message }: { reason: string; message: (args: { reason: string }) => string }): TranscriptionPort {
  return {
    isAvailable: async () => ({ available: false, reason }),
    transcribe: async () => { throw new Error(message({ reason })); },
  };
}
/** Select lazily so unsupported platforms never construct the native implementation. */
export function resolveTranscriptionPort({ platform, createMacPort, messages }: ResolveTranscriptionPortDeps): TranscriptionPort {
  if (platform !== "darwin") return unavailablePort({ reason: messages.unsupportedPlatform({ platform }), message: messages.unavailable });
  return createMacPort();
}
