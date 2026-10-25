/**
 * @module ai-trace
 * Vendor-neutral AI-run tracing: contract, recorder over the normalized agent-event stream, and
 * backend-free sinks. Vendor adapters live on their own subpaths (e.g. `./ai-trace/langfuse`)
 * so this entry never pulls an SDK.
 */
export type * from './types.js';
export { createAiTraceRecorder, type AiTraceRecorder, type AiTraceRecorderOptions } from './recorder.js';
export { noopAiTraceSink, createRecordingAiTraceSink, createFanOutAiTraceSink, createLazyAiTraceSink, DEFAULT_LAZY_SINK_QUEUE, type RecordingAiTraceSink } from './sinks.js';
export { captureText, DEFAULT_MAX_CAPTURED_CHARS, type CaptureTextOptions } from './capture.js';
export { classifyToolError } from './classify.js';
export { normalizeAiUsage } from './usage.js';
