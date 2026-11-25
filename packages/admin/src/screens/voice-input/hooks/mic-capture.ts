/**
 * @file The one impure piece of this feature: actual microphone capture via the Web Audio API,
 * and the one call out to `SpeechBridge.transcribe`. the host's push-to-talk hook takes this
 * behind an injectable `PushToTalkCapture` interface so its own orchestration (state transitions,
 * error handling, calling `onTranscript`) is testable against a fake. This file's capture,
 * transcription and cleanup paths are tested with Web Audio boundary fakes in
 * `mic-capture.unit.test.ts`; no real microphone is opened by that test.
 *
 * Uses `ScriptProcessorNode` rather than an `AudioWorklet`. It is the deprecated API, kept here
 * deliberately for this first cut: an `AudioWorklet` needs its processor module loaded from a
 * separate URL (`audioContext.audioWorklet.addModule(...)`), which this Vite-bundled admin app has
 * no existing convention for serving — solving that packaging question is a reasonable follow-up,
 * not a blocker for a working v1. `ScriptProcessorNode` still works in every browser Electron ships.
 */

import type { SpeechBridge } from "@jini-ai/core/contracts/speech-transcription";

export interface PushToTalkCapture {
  /** Requests the microphone and starts buffering audio. Rejects with a human-readable reason
   *  (e.g. the browser's own permission-denied message) if the user or OS refuses access. */
  start(): Promise<void>;
  /** Stops capturing, releases the microphone, and transcribes everything buffered since `start`. */
  stopAndTranscribe(): Promise<string>;
}

const CAPTURE_BUFFER_SIZE = 4096;
const CAPTURE_CHANNEL_COUNT = 1;

/**
 * Concatenates every captured chunk into one contiguous buffer — `voicePort.transcribe` takes one
 * complete recording, not a stream of chunks.
 * @complexity Time/space: O(n) in total sample count.
 */
function concatFloat32Chunks({ chunks }: { chunks: Float32Array[] }, _options = {}): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

/**
 * Builds a real, microphone-backed {@link PushToTalkCapture}.
 *
 * @param voicePort - Already confirmed available by the caller (the host's push-to-talk hook only
 *   constructs this when the host's voice-port getter returned non-null).
 * @complexity Time/space: O(1) to construct; `start`/`stopAndTranscribe` are O(n) in recording
 *   length plus the recognizer's own cost.
 */
export function createMicPushToTalkCapture(voicePort: SpeechBridge): PushToTalkCapture {
  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let chunks: Float32Array[] = [];

  async function start(): Promise<void> {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      processor = audioContext.createScriptProcessor(CAPTURE_BUFFER_SIZE, CAPTURE_CHANNEL_COUNT, CAPTURE_CHANNEL_COUNT);
      chunks = [];
      processor.onaudioprocess = (audioEvent) => {
        // Copy out of the input buffer — it is reused by the audio graph after this callback returns.
        chunks.push(new Float32Array(audioEvent.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      // Some browsers only fire `onaudioprocess` once the node is in the graph's path to the
      // destination, even though this app never plays the captured audio back.
      processor.connect(audioContext.destination);
    } catch (error) {
      processor?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      await audioContext?.close();
      stream = null;
      audioContext = null;
      processor = null;
      chunks = [];
      throw error;
    }
  }

  async function stopAndTranscribe(): Promise<string> {
    processor?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    const sampleRate = audioContext?.sampleRate ?? 16000;
    const recordedSamples = concatFloat32Chunks({ chunks });
    await audioContext?.close();
    stream = null;
    audioContext = null;
    processor = null;
    chunks = [];

    const result = await voicePort.transcribe({ samples: recordedSamples, sampleRate });
    return result.text;
  }

  return { start, stopAndTranscribe };
}
