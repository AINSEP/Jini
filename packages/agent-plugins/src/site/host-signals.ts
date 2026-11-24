import { readAgentPluginMetadata, type AgentPluginHostSignal } from "@jini-ai/agent-plugins/manifest";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AgentPluginPathsPort } from "@jini-ai/agent-plugins/site/service-ports";

/**
 * @file Host signals declared by shipped (bundled) agent plugins: a pure manifest parser, a hermetic
 * bundled reader, and a resolver that binds those hints to the host's core security policy. The host
 * injects its bundled-source policy (`sources`) and its policy functions (`evaluateHostSignals`,
 * `selectCoreHostSignalDeclaration`, which own the security fallback); see `README.md` `## Wiring`.
 */

/** Validated host-signal hints from shipped plugin manifests (structurally the host's declaration type). */
export interface BundledHostSignalDeclaration {
  readonly signals: readonly AgentPluginHostSignal[];
  readonly deploymentAdvice?: string;
}

/** The host's hermetic bundled-source policy: which packages under `sourceRoot` ship `filename`. */
export type BundledHostSignalSources = (required: { readonly sourceRoot: string; readonly filename: string }) => readonly { readonly packageRoot: string }[];

/** The host's core policy functions; they own the security fallback, this module only supplies data. */
export interface HostSignalPolicyPorts<S> {
  readonly evaluateHostSignals: (required: { env: Readonly<Record<string, string | undefined>>; declaration: BundledHostSignalDeclaration }) => S;
  readonly selectCoreHostSignalDeclaration: (required: { declaration?: BundledHostSignalDeclaration }) => BundledHostSignalDeclaration;
}

/**
 * Read Jini's validated portable extension; malformed declarations contribute nothing.
 * @param required Parsed JSON manifest, never executable plugin code.
 * @returns Validated hints, or undefined for absent/invalid metadata. Never throws for JSON input.
 * @complexity O(s) for s declared signals; no I/O.
 * @example parseHostSignalDeclaration({ manifest: JSON.parse(text) });
 */
export function parseHostSignalDeclaration({ manifest }: { manifest: unknown }, _optional = {}): BundledHostSignalDeclaration | undefined {
  const { metadata } = readAgentPluginMetadata({ value: manifest });
  if (metadata.hostSignals === undefined) return undefined;
  return { signals: metadata.hostSignals, ...(metadata.deploymentAdvice === undefined ? {} : { deploymentAdvice: metadata.deploymentAdvice }) };
}

interface ReaderPorts {
  readonly readText?: (file: string) => string;
}

/**
 * Read only manifests from the hermetic bundled source policy, independent of site activation.
 * @param required Product-controlled content/agent-plugins root, never an installed package dir, and the
 * host's bundled-source policy (`sources`).
 * @param optional Text reader port for direct failure-path tests.
 * @returns Validated unambiguous data. Absent/malformed packages contribute no declaration;
 * the resolver applies the core security fallback rather than treating absent data as permission.
 * @complexity O(p + s) for p plugin manifests and s signals; one synchronous read per manifest.
 * @example readBundledHostSignalDeclaration({ sourceRoot, sources });
 */
export function readBundledHostSignalDeclaration(
  required: { readonly sourceRoot: string; readonly sources: BundledHostSignalSources }, optional: ReaderPorts = {},
): BundledHostSignalDeclaration {
  // Preboot readers must not turn a missing bundled payload into a boot failure (phase 2 policy).
  const sources = orFallbackSync({
    work: () => required.sources({ sourceRoot: required.sourceRoot, filename: "plugin.json" }),
    fallback: [],
    step: "list bundled host signal manifests",
  });
  const declarations = sources.flatMap(source => {
    return orFallbackSync({
      work: () => {
        const file = path.join(source.packageRoot, "plugin.json");
        const text = optional.readText === undefined || optional.readText === null ? readManifestText({ file }) : optional.readText(file);
        const declaration = parseHostSignalDeclaration({ manifest: JSON.parse(text) });
        return declaration === undefined ? [] : [declaration];
      },
      fallback: [],
      step: "read bundled host signal manifest",
    });
  });
  return combineDeclarations({ declarations });
}

/** Reject the whole ambiguous declaration so the resolver can retain the complete core fallback.
 * @complexity O(s + p) for s signals and p declarations, with no I/O or input mutation. */
function combineDeclarations({ declarations }: { declarations: readonly BundledHostSignalDeclaration[] }, _optional = {}): BundledHostSignalDeclaration {
  const signals = declarations.flatMap(declaration => declaration.signals);
  const names = new Set(signals.map(signal => signal.env));
  const advice = [...new Set(declarations.flatMap(declaration => declaration.deploymentAdvice === undefined ? [] : [declaration.deploymentAdvice]))];
  if (names.size !== signals.length || advice.length > 1) return { signals: [] };
  return { signals, ...(advice.length === 1 ? { deploymentAdvice: advice[0] } : {}) };
}

/** Node's text-only manifest read; errors are caught at the bundled adapter boundary. */
function readManifestText({ file }: { file: string }, _optional: Record<string, never> = {}): string { return readFileSync(file, "utf8"); }

/**
 * Bind the host's bundled-source fact to the pure evaluator; no plugin imports, DB or activation needed.
 * @param required Environment snapshot, values are never logged or returned as diagnostic copy; plus the
 * host's bundled-source policy and core policy functions.
 * @param optional Declaration reader port; desktop may supply its payload in the required path fact.
 * @returns Facts only; unavailable/incomplete/ambiguous security data uses the core HEAD fallback.
 * Read failures never fail boot or disable the baseline hosted protections.
 * @complexity O(p + s) as for the reader.
 * @example resolveBundledHostSignals({ env, bundledSourceRoot, sources, evaluateHostSignals, selectCoreHostSignalDeclaration });
 */
export function resolveBundledHostSignals<S>(
  required: Pick<AgentPluginPathsPort, "bundledSourceRoot"> & HostSignalPolicyPorts<S> & {
    env: Readonly<Record<string, string | undefined>>;
    readonly sources: BundledHostSignalSources;
  },
  optional: { readDeclaration?: (required: { readonly sourceRoot: string }) => BundledHostSignalDeclaration } = {},
): S {
  return orFallbackSync({
    work: () => {
      const sourceRoot = required.bundledSourceRoot;
      const read = optional.readDeclaration ?? (({ sourceRoot: root }) => readBundledHostSignalDeclaration({ sourceRoot: root, sources: required.sources }));
      const declaration = required.selectCoreHostSignalDeclaration({ declaration: read({ sourceRoot }) });
      return required.evaluateHostSignals({ env: required.env, declaration });
    },
    fallback: undefined,
    step: "resolve bundled host signals",
  }) ?? required.evaluateHostSignals({ env: required.env, declaration: required.selectCoreHostSignalDeclaration({}) });
}
