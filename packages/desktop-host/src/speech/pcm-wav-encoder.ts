/**
 * Mono 16-bit PCM WAV needs only a fixed 44-byte header and raw samples. An external encoder or
 * ffmpeg would add install size, license review and supply-chain surface for this small format.
 * Capture happens in the renderer's Web Audio API; this module only encodes those samples.
 */
const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2; // 16-bit PCM
const PCM_FORMAT_CODE = 1;
const CHANNEL_COUNT = 1; // mono — matches the recognizer's own expectation and halves upload size

/** Clamp and quantize mono samples to signed 16-bit PCM. */
function float32ToInt16Pcm({ samples: float32Samples }: { samples: Float32Array }): Int16Array {
  const int16Samples = new Int16Array(float32Samples.length);
  for (let i = 0; i < float32Samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, float32Samples[i] as number));
    int16Samples[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return int16Samples;
}

/** Build the canonical mono PCM RIFF header. */
function buildWavHeader({ sampleCount, sampleRate }: { sampleCount: number; sampleRate: number }): Buffer {
  const dataBytes = sampleCount * BYTES_PER_SAMPLE;
  const byteRate = sampleRate * CHANNEL_COUNT * BYTES_PER_SAMPLE;
  const blockAlign = CHANNEL_COUNT * BYTES_PER_SAMPLE;
  const header = Buffer.alloc(WAV_HEADER_BYTES);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(PCM_FORMAT_CODE, 20);
  header.writeUInt16LE(CHANNEL_COUNT, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);

  return header;
}

/** Encode a complete mono WAV with the caller-provided capture rate. */
// The recognizer accepts any rate; 16000 Hz keeps the renderer-to-main IPC payload small.
function encodeMonoWav({ samples, sampleRate }: { samples: Float32Array | number[]; sampleRate: number }): Buffer {
  const float32Samples = samples instanceof Float32Array ? samples : Float32Array.from(samples);
  const pcm = float32ToInt16Pcm({ samples: float32Samples });
  const header = buildWavHeader({ sampleCount: pcm.length, sampleRate });
  const body = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return Buffer.concat([header, body]);
}

export { encodeMonoWav, float32ToInt16Pcm, buildWavHeader, WAV_HEADER_BYTES };
