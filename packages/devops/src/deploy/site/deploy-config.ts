import { readFileSync } from "node:fs";
import { join } from "node:path";

import { assertNoConfigInjection } from "../config-injection.js";
import type { DeploymentSecret, DeploymentDescriptor, RenderedDeployConfig, DeployConfigKit } from "../config-contracts.js";

/**
 * @file The ONE `DeploymentDescriptor` every platform config generator is a thin, pure function over —
 * the host CLI's `deploy config --target <id>` single source of truth. The generators themselves are
 * plugin modules (the bundled hosting plugins' `deploy-configs/*.mjs`, declared in each one's
 * manifest, loaded by `./deploy-config-registry.ts`); this file keeps only the vendor-neutral half:
 * the descriptor derivation, the injection-guard kit and the host deploy-notes overlay. Every
 * product value (the command label in error text, the secrets list, the health-route source and
 * pattern, the migrations note, the host's validation error) is injected by the host binding.
 *
 * Purpose:
 * Every emitted config states the same small set of facts (image built from `./Dockerfile`, the
 * port it listens on, where its one persistent volume mounts, its health-check path, which env
 * vars must be set through the platform's own secret mechanism) — only the SERIALIZATION differs
 * per platform. Four independent generators each hardcoding these facts would mean four copies of
 * the same knowledge, silently rotting three at a time the day one of them changes. This module is
 * the fix: build the descriptor once, here, then hand it to whichever generator the caller asked
 * for. Another platform is one new plugin module plus one manifest line, never a change to this one.
 *
 * Derivation over hardcoding, wherever that's reasonably possible: {@link buildDeploymentDescriptor}
 * reads the repo's own already-committed files (`Dockerfile`, `package.json`, the readiness route's own
 * source) rather than repeating their values as separate literals that could drift out of sync.
 * Each derivation names its exact source below; a field that genuinely can't be derived (which env
 * vars are load-bearing secrets — a semantic judgment call, not a textual pattern) is supplied by the
 * host with a comment citing the code that was read to decide it.
 */

/** The host's overlay reader seam for {@link appendHostDeployNotes}. */
export interface HostDeployNotesReadPorts {
  /** Reads a file, or returns `undefined` when it does not exist. */
  readonly readFile?: (required: { file: string }, options?: object) => string | undefined;
}

function readOptionalFile({ file }: { file: string }, _options = {}): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** The notes array for `targetId`, or a loud error naming the malformed overlay file. */
function hostNotesFor({ raw, targetId, file, commandLabel }: { raw: string; targetId: string; file: string; commandLabel: string }, _options = {}): readonly string[] {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${commandLabel}: ${file} must map each target id to an array of note strings (target "${targetId}")`);
  }
  const entry = Object.hasOwn(parsed, targetId) ? (parsed as Record<string, unknown>)[targetId] : undefined;
  if (entry === undefined) return [];
  if (!Array.isArray(entry) || !entry.every((note) => typeof note === "string")) {
    throw new Error(`${commandLabel}: ${file} must map each target id to an array of note strings (target "${targetId}")`);
  }
  return entry;
}

/**
 * Appends the host's own notes for a deploy target after its plugin generator rendered: the notes in
 * `<overlays>/<plugin>/deploy-notes.json`, keyed by target id (a plugin may contribute several
 * targets). A note about the host's own Dockerfile (e.g. an opt-in build flag) is the host's note,
 * not the vendor plugin's, so it has to be stated wherever a host's config is generated.
 *
 * A note the generator already printed is not repeated: the bundled generators printed these same
 * notes before the cutover to the Jini packages, so the append is safe on both sides of it.
 *
 * @throws {Error} When the overlay's notes file exists but is not valid JSON of that shape.
 * @complexity O(n · m) for n host notes and m rendered notes (both a handful).
 */
export function appendHostDeployNotes(
  { pluginId, targetId, rendered, overlaysDir, commandLabel }: {
    readonly pluginId: string; readonly targetId: string; readonly rendered: RenderedDeployConfig;
    /** The host's overlay root (absolute). */
    readonly overlaysDir: string;
    /** The host CLI command named in error text (e.g. `"<product> deploy config"`). */
    readonly commandLabel: string;
  },
  { readFile = readOptionalFile }: HostDeployNotesReadPorts = {}
): RenderedDeployConfig {
  // Publisher ids are `<publisher>/<name>`; overlay folders are named by the plugin's own name.
  const pluginName = pluginId.slice(pluginId.lastIndexOf("/") + 1);
  const file = join(overlaysDir, pluginName, "deploy-notes.json");
  const raw = readFile({ file });
  if (raw === undefined) return rendered;
  const extra = hostNotesFor({ raw, targetId, file, commandLabel }).filter((note) => !rendered.notes.includes(note));
  return extra.length === 0 ? rendered : { ...rendered, notes: [...rendered.notes, ...extra] };
}

/**
 * The kit every generator gets. The host binds the injection guard to its own validation error and to
 * the positional `(fieldLabel, value)` the plugins call. Its two sink shapes: the TOML-emitting plugin's
 * quoted sinks, and the unquoted YAML `name:` lines of the YAML-emitting plugin (the app name and its
 * disk's volume name). Quoting those at render time was rejected because the bundled generators'
 * exact-string golden tests pin the CURRENT unquoted rendering for a safe name (`name: acme-app`):
 * quoting would change every already-safe name's output. A per-host region allow-list is each
 * generator's own choice (one host's catalog had no authoritative source to enumerate against; its
 * generator says why). @complexity O(1).
 */
export function createDeployConfigKit(
  { validationError, migrationsNote }: { readonly validationError: (required: { message: string }) => Error; readonly migrationsNote: string },
  _optional = {}
): DeployConfigKit {
  return {
    assertNoConfigInjection: (fieldLabel, value) => assertNoConfigInjection({ fieldLabel, value, fail: validationError }),
    validationError: (message) => validationError({ message }),
    migrationsNote,
  };
}

/** Where the readiness check path is read from: a repo-relative source file, the pattern whose first
 *  group is the path, and the label error text names it by. */
export interface HealthCheckSource {
  readonly relPath: string;
  readonly pattern: RegExp;
  readonly sourceFile: string;
}

/**
 * Regex-extracts one derived fact from an already-read repo file's contents, or fails LOUDLY: a
 * silent fallback here would be exactly the kind of drift this module exists to prevent (see this
 * file's own header). `describe`/`sourceFile` name the fact and its origin so the thrown message
 * tells a reader exactly what changed and where to look — never a bare "no match".
 */
function extractOrThrow(
  { source, pattern, describe, sourceFile, commandLabel }: { source: string; pattern: RegExp; describe: string; sourceFile: string; commandLabel: string },
  _options = {}
): string {
  const match = source.match(pattern);
  if (!match || match[1] === undefined) {
    throw new Error(
      `${commandLabel}: could not derive ${describe} from ${sourceFile} — its format changed since ` +
        `deploy-config.ts's extraction pattern was written. Update the pattern in deploy-config.ts to match ` +
        `the new format, or hardcode the value there instead with a comment explaining why it can no longer ` +
        `be derived.`
    );
  }
  return match[1];
}

/**
 * Builds the one `DeploymentDescriptor` every renderer works from, deriving each field from the
 * repo's own already-committed files (see each field's own doc on {@link DeploymentDescriptor} for
 * its exact source). Reads three real files from disk on every call rather than caching — this runs
 * once per CLI invocation, not in a hot path, so freshness (never serving a value from a file that
 * has since changed underneath a long-lived process) is worth more than the trivial I/O cost saved.
 *
 * Every path is relative to `repoRoot` — the host passes its repo root (the CLI's cwd).
 *
 * @throws {Error} when a source file's format has drifted far enough that a derivation pattern no
 *   longer matches — see {@link extractOrThrow}. Never returns a guessed or partially-stale value.
 * @complexity O(n) in the total source text — three reads and fixed extraction passes.
 */
export function buildDeploymentDescriptor(
  { repoRoot, commandLabel, healthCheck, secrets }: {
    readonly repoRoot: string; readonly commandLabel: string;
    readonly healthCheck: HealthCheckSource; readonly secrets: readonly DeploymentSecret[];
  },
  _optional = {}
): DeploymentDescriptor {
  const read = (relPath: string): string => readFileSync(join(repoRoot, relPath), "utf8");
  const dockerfile = read("Dockerfile");
  const packageJson = read("package.json");
  const healthRouteSource = read(healthCheck.relPath);

  const port = Number(extractOrThrow({ source: dockerfile, pattern: /^EXPOSE\s+(\d+)\s*$/m, describe: "the container port", sourceFile: "Dockerfile (EXPOSE line)", commandLabel }));
  const dockerfilePath = "Dockerfile";
  const appName = extractOrThrow({ source: packageJson, pattern: /^[^\S\r\n\u2028\u2029]*"name"\s*:\s*"([^"]+)"/mu, describe: "the default app name", sourceFile: "package.json (name)", commandLabel });
  const volumeName = `${appName}_sites`;
  const volumeMountPath = extractOrThrow({
    source: dockerfile,
    pattern: /^VOLUME\s+\["([^"]+)"\]\s*$/m,
    describe: "the volume mount path",
    sourceFile: "Dockerfile (VOLUME line)",
    commandLabel,
  });
  const healthCheckPath = extractOrThrow({ source: healthRouteSource, pattern: healthCheck.pattern, describe: "the readiness check path", sourceFile: healthCheck.sourceFile, commandLabel });

  return { appName, port, dockerfilePath, volumeMountPath, volumeName, healthCheckPath, secrets };
}
