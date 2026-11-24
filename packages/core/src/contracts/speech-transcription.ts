/**
 * @file The neutral on-device speech contract shared by a desktop shell's main process, its
 * sandboxed preload bridge, and the renderer-side voice input that calls it. One definition here
 * means the shell and the renderer cannot drift apart on the wire shape that crosses the IPC
 * boundary.
 */

/** Successful recognition of silence returns empty text, never null; elapsedMs supports latency logs. */
export interface TranscriptionResult { text: string; elapsedMs: number }

/** Whether the recognizer can run now; `reason` carries a host-owned code explaining why not. */
export interface TranscriptionAvailability { available: boolean; reason?: string | undefined }

/** One captured utterance: mono PCM samples and the rate they were captured at. */
export interface SpeechTranscribeRequest { samples: Float32Array | readonly number[]; sampleRate: number }

/** The renderer-visible bridge a desktop shell exposes under a host-owned global name. */
export interface SpeechBridge {
  isAvailable(): Promise<TranscriptionAvailability>;
  transcribe(args: SpeechTranscribeRequest): Promise<TranscriptionResult>;
}
