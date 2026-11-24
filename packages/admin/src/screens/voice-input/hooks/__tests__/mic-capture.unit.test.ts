import { afterEach, describe, expect, it, vi } from "vitest";
import { createMicPushToTalkCapture } from "../mic-capture.js";

afterEach(() => vi.unstubAllGlobals());

function setup(failSetup = false, rejectTranscription = false) {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  const stream = { getTracks: () => tracks };
  const processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null as ((event: any) => void) | null };
  const source = { connect: vi.fn() };
  const context = {
    sampleRate: 48000, destination: {},
    createMediaStreamSource: vi.fn(() => source),
    createScriptProcessor: vi.fn(() => {
      if (failSetup) throw new Error("audio setup failed");
      return processor;
    }),
    close: vi.fn(async () => {}),
  };
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("AudioContext", class { constructor() { return context; } });
  const transcribe = vi.fn(async ({ samples, sampleRate }: { samples: Float32Array | number[]; sampleRate: number }, _options = {}) => {
    for (const track of tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    if (rejectTranscription) throw new Error("transcription failed");
    return { text: "hello", elapsedMs: 1 };
  });
  const capture = createMicPushToTalkCapture({ isAvailable: async () => ({ available: true }), transcribe });
  return { capture, tracks, context, processor, source, stream, getUserMedia, transcribe };
}

describe("real microphone capture with Web Audio boundary fakes", () => {
  it("preserves microphone permission errors before any audio resources exist", async () => {
    const f = setup();
    f.getUserMedia.mockRejectedValueOnce(new Error("microphone permission denied"));
    await expect(f.capture.start()).rejects.toThrow("microphone permission denied");
    expect(f.context.createMediaStreamSource).not.toHaveBeenCalled();
    expect(f.processor.disconnect).not.toHaveBeenCalled();
    expect(f.context.close).not.toHaveBeenCalled();
    for (const track of f.tracks) expect(track.stop).not.toHaveBeenCalled();
    expect(f.transcribe).not.toHaveBeenCalled();
  });

  it("disconnects the processor and releases the microphone if connecting the graph fails", async () => {
    const f = setup();
    f.processor.connect.mockImplementationOnce(() => { throw new Error("audio graph unavailable"); });
    await expect(f.capture.start()).rejects.toThrow("audio graph unavailable");
    expect(f.processor.disconnect).toHaveBeenCalledTimes(1);
    for (const track of f.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(f.context.close).toHaveBeenCalledTimes(1);
    expect(f.transcribe).not.toHaveBeenCalled();
  });

  it("transcribes an empty recording at the fallback sample rate before capture starts", async () => {
    const transcribe = vi.fn(async () => ({ text: "No speech", elapsedMs: 0 }));
    const capture = createMicPushToTalkCapture({ isAvailable: async () => ({ available: true }), transcribe });
    await expect(capture.stopAndTranscribe()).resolves.toBe("No speech");
    expect(transcribe).toHaveBeenCalledExactlyOnceWith({ samples: new Float32Array(), sampleRate: 16000 });
  });

  it.each([false, true])("copies chunks in order and releases all resources before transcribe (reject=%s)", async (reject) => {
    const f = setup(false, reject);
    await f.capture.start();
    expect(f.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(f.context.createMediaStreamSource).toHaveBeenCalledWith(f.stream);
    expect(f.source.connect).toHaveBeenCalledWith(f.processor);
    expect(f.processor.connect).toHaveBeenCalledWith(f.context.destination);
    const buffer = new Float32Array([1, 2]);
    f.processor.onaudioprocess!({ inputBuffer: { getChannelData: () => buffer } });
    buffer.fill(9); // The browser reuses this buffer.
    f.processor.onaudioprocess!({ inputBuffer: { getChannelData: () => new Float32Array([3]) } });
    if (reject) await expect(f.capture.stopAndTranscribe()).rejects.toThrow("transcription failed");
    else await expect(f.capture.stopAndTranscribe()).resolves.toBe("hello");
    expect(f.processor.disconnect).toHaveBeenCalledTimes(1);
    expect(f.transcribe).toHaveBeenCalledExactlyOnceWith({ samples: new Float32Array([1, 2, 3]), sampleRate: 48000 });
  });

  it("releases the granted stream and context when audio setup fails during start", async () => {
    const f = setup(true);
    await expect(f.capture.start()).rejects.toThrow("audio setup failed");
    for (const track of f.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(f.context.close).toHaveBeenCalledTimes(1);
    expect(f.transcribe).not.toHaveBeenCalled();
  });
});
