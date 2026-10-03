import { encodeMonoWav, float32ToInt16Pcm as convert, buildWavHeader, WAV_HEADER_BYTES } from "../pcm-wav-encoder.js";
const float32ToInt16Pcm = (samples: Float32Array) => convert({ samples });
/**
 * @file Direct tests for `pcm-wav-encoder.ts` — pure buffer math, no Electron and no audio
 * hardware involved.
 */
import { test } from "vitest";
import assert from "node:assert/strict";


test("float32ToInt16Pcm maps the full range and midpoints correctly", () => {
  const int16 = float32ToInt16Pcm(Float32Array.from([0, 1, -1, 0.5, -0.5]));
  // Int16Array's own assignment coercion truncates toward zero, not rounds — Math.trunc here
  // matches that, not Math.round.
  assert.deepEqual(Array.from(int16), [0, 0x7fff, -0x8000, Math.trunc(0.5 * 0x7fff), Math.trunc(-0.5 * 0x8000)]);
});

test("float32ToInt16Pcm clamps out-of-range input instead of wrapping", () => {
  const int16 = float32ToInt16Pcm(Float32Array.from([2.5, -3]));
  assert.deepEqual(Array.from(int16), [0x7fff, -0x8000]);
});

test("buildWavHeader is exactly 44 bytes and encodes the RIFF/WAVE/fmt/data structure", () => {
  const header = buildWavHeader({ sampleCount: 100, sampleRate: 16000 });
  assert.equal(header.length, WAV_HEADER_BYTES);
  assert.equal(header.length, 44);
  assert.equal(header.readUInt32LE(16), 16); // fmt chunk size
  assert.equal(header.readUInt16LE(20), 1); // PCM format
  assert.equal(header.readUInt32LE(28), 32000); // mono 16-bit byte rate
  assert.equal(header.readUInt16LE(32), 2); // block alignment
  assert.equal(header.toString("ascii", 0, 4), "RIFF");
  assert.equal(header.toString("ascii", 8, 12), "WAVE");
  assert.equal(header.toString("ascii", 12, 16), "fmt ");
  assert.equal(header.toString("ascii", 36, 40), "data");
  assert.equal(header.readUInt32LE(24), 16000); // sample rate
  assert.equal(header.readUInt16LE(22), 1); // mono
  assert.equal(header.readUInt16LE(34), 16); // bits per sample
  assert.equal(header.readUInt32LE(40), 100 * 2); // data chunk byte length
  assert.equal(header.readUInt32LE(4), 36 + 100 * 2); // RIFF chunk size
});

test("encodeMonoWav produces a header-plus-samples buffer whose data chunk matches the input", () => {
  const samples = Float32Array.from([0, 1, -1]);
  const wav = encodeMonoWav({ samples, sampleRate: 16000 });
  assert.equal(wav.length, WAV_HEADER_BYTES + samples.length * 2);
  const dataSection = wav.subarray(WAV_HEADER_BYTES);
  assert.equal(dataSection.readInt16LE(0), 0);
  assert.equal(dataSection.readInt16LE(2), 0x7fff);
  assert.equal(dataSection.readInt16LE(4), -0x8000);
});

test("encodeMonoWav accepts a plain array, not just a Float32Array", () => {
  const wav = encodeMonoWav({ samples: [0, 0.5], sampleRate: 8000 });
  assert.equal(wav.length, WAV_HEADER_BYTES + 4);
  assert.equal(wav.readUInt32LE(24), 8000);
  assert.deepEqual([wav.readInt16LE(44), wav.readInt16LE(46)], [0, 0x3fff]);
});

test("encodeMonoWav of an empty recording is still a valid, playable zero-length WAV", () => {
  const wav = encodeMonoWav({ samples: [], sampleRate: 16000 });
  assert.equal(wav.length, WAV_HEADER_BYTES);
  assert.equal(wav.readUInt32LE(40), 0);
});
