/**
 * Node-native binding of `../../speech/macos`'s on-device recognizer: the real `fs`,
 * `execFile`, temp-file naming and the published Swift helper source, with the host's helper binary
 * path, error wording and temp-file prefix injected.
 *
 * **Zero downloaded model data.** The helper links `Speech`/`SFSpeechRecognizer` against the
 * speech models macOS ships with the OS; nothing is fetched at install or first run. whisper.cpp
 * was rejected for its ~75MB model download — this path adds none.
 *
 * **No silent network fallback.** Every request the helper builds sets
 * `requiresOnDeviceRecognition = true` (`speech/macos/speech-helper.swift`). If on-device assets are
 * not installed for the recognizer's locale, `SFSpeechRecognizer` does not silently use the network
 * instead — it fails the request, and this module surfaces that failure as `available: false` / a
 * rejected `transcribe()` rather than papering over it. Silently transcribing over the network would
 * defeat the entire point (a local-first host; browser speech recognition uploads audio to a
 * vendor's servers) and the caller would have no way to know it happened, so "on-device
 * unavailable" is a reportable stop condition, never a fallback trigger.
 *
 * Helper spike history: synthesized speech first proved this subprocess approach. Its initial
 * semaphore-based CLI starved the main queue's XPC callbacks and timed out on every run at the
 * 30s ceiling; the Swift helper pumps the run loop instead. Keep its 15s authorization and
 * 30s recognition budgets, and never replace the loop with a blocking main-thread semaphore.
 *
 * The compiled helper binary is never committed — the recognizer lazily runs `swiftc` against the
 * source the first time it is needed and caches the binary at the host's `binaryPath`. A machine
 * with no `swiftc` simply reports `unavailable` instead of failing to install.
 *
 * Wiring: the host injects `binaryPath` (computed in the host exactly where its cache has always
 * lived; moving this module must not move that cache), `messages` and `tempFilePrefix`.
 */
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  createMacOnDeviceTranscriptionPort as createMacPort,
  type MacTranscriberDeps, type MacTranscriberMessages,
} from "../../speech/macos/index.js";
import type { TranscriptionPort } from "../../speech/index.js";
// ESM has no synchronous import; createRequire preserves lazy loading of the native Node adapters.
const require = createRequire(import.meta.url);

export interface NativeMacTranscriberConfig {
  /** Where the compiled helper is cached; a separate cache per helper protocol version. */
  binaryPath: string;
  messages: MacTranscriberMessages;
  /** Basename prefix of each temporary WAV under `os.tmpdir()`, before a random UUID. */
  tempFilePrefix: string;
}

/**
 * Resolve the published Swift asset only when macOS speech is constructed: the same file the
 * `./speech/macos/speech-helper.swift` export names (the build copies it beside `speech/macos`).
 * @complexity O(1).
 */
export function speechHelperSourcePath(_requiredArgs: Record<string, never>, _optional: Record<string, never> = {}): string {
  return fileURLToPath(new URL("../../speech/macos/speech-helper.swift", import.meta.url));
}

/** Bind Node's native signatures without running recognition. @complexity O(1). */
function realDependencies({ binaryPath, sourcePath, messages, tempFilePrefix }: NativeMacTranscriberConfig & { sourcePath: string }): MacTranscriberDeps {
  // Requiring inside the factory keeps non-macOS hosts from loading the process/promisify
  // adapters at module import; resolveTranscriptionPort selects platform eligibility first.
  const { execFile }: typeof import("node:child_process") = require("node:child_process");
  const { promisify }: typeof import("node:util") = require("node:util");
  const fs: typeof import("node:fs") = require("node:fs");
  const execFileAsync = promisify(execFile);
  return {
    fs: {
      existsSync: ({ path }) => fs.existsSync(path),
      mkdirSync: ({ path }, { recursive = false } = {}) => fs.mkdirSync(path, { recursive }),
      writeFileSync: ({ path, data }) => fs.writeFileSync(path, data),
      rmSync: ({ path }, { force = false } = {}) => fs.rmSync(path, { force }),
    },
    // No `spawnSync` adapter: the helper is compiled through `execFileAsync`, and the deps'
    // `spawnSync` is deprecated and never called.
    execFileAsync: ({ file, args }) => execFileAsync(file, args),
    sourcePath, binaryPath, compilerPath: "swiftc", locale: "en-US", messages,
    tempFilePath: () => path.join(os.tmpdir(), `${tempFilePrefix}${crypto.randomUUID()}.wav`),
  };
}

/**
 * Construct on-device recognition with host policy and optional injected ports.
 * Keep realDependencies separate so a caller can override only the few ports it needs
 * while every omitted dependency still follows the production path. Call only on darwin;
 * resolveTranscriptionPort decides platform eligibility before reaching this factory.
 * @complexity O(1) to construct; native compilation/recognition happens only when used.
 */
export function createNativeMacTranscriptionPort(config: NativeMacTranscriberConfig, overrides: Partial<MacTranscriberDeps> = {}): TranscriptionPort {
  const sourcePath = overrides.sourcePath ?? speechHelperSourcePath({});
  const binaryPath = overrides.binaryPath ?? config.binaryPath;
  return createMacPort({ ...realDependencies({ ...config, sourcePath, binaryPath }), ...overrides });
}
