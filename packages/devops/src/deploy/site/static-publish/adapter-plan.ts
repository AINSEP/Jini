import path from 'node:path';
import type { DeployTargetRegistry, LoadedDeployTarget } from '../deploy-targets/types.js';
import type { StaticPublishConfig, StaticPublishTargetId } from './types.js';
import type { StaticPublishDeps, StaticPublishInput } from './adapter.js';
import type { UnknownRecord } from '../../index.js';

/** {@link planStaticPublish}'s answer: the resolved target and the base path it serves from, or a
 *  human-readable refusal safe to return over an HTTP/tool boundary. */
export type StaticPublishPlan =
  | { readonly ok: true; readonly target: LoadedDeployTarget; readonly basePath?: string }
  | { readonly ok: false; readonly message: string };

/**
 * Resolves `config.target` in `registry` and checks `config` against it: every required descriptor
 * field present and non-blank, then the module's own `validateConfig`. Pure given the registry, so
 * the admin preview, the agent tools and a real publish all reach the SAME verdict and base path.
 *
 * @returns The plan, or the first refusal. Messages never echo more than the offending field.
 * @complexity O(f) declared config fields plus the module's own (constant-size) checks.
 */
export function planStaticPublish({ registry, config }: { registry: DeployTargetRegistry; config: StaticPublishConfig }, _optional: Record<string, never> = {}): StaticPublishPlan {
  const target = registry.get(config.target);
  if (target === undefined) return { ok: false, message: unknownTargetMessage({ registry, targetId: config.target }) };
  const missing = missingRequiredFieldMessage({ target, config });
  if (missing !== null) return { ok: false, message: missing };
  const moduleConfig = config as unknown as UnknownRecord;
  const configError = target.module.validateConfig?.(moduleConfig);
  if (configError) return { ok: false, message: configError };
  const basePath = target.module.basePath?.(moduleConfig);
  return { ok: true, target, ...(basePath !== undefined ? { basePath } : {}) };
}

/** The refusal for the first descriptor-required field `config` leaves absent or blank, else `null`.
 *  Exported so the admin preview can answer a missing field as a malformed request (400) while a
 *  present-but-invalid value stays a 200 `valid:false`. @complexity O(f) declared config fields. */
export function missingRequiredFieldMessage({ target, config }: { target: LoadedDeployTarget; config: StaticPublishConfig }, _optional: Record<string, never> = {}): string | null {
  for (const field of target.descriptor.configFields) {
    const value = config[field.name];
    if (field.required && (typeof value !== "string" || value.trim() === "")) {
      return `'${field.name}' (non-empty string) is required for target '${config.target}'`;
    }
  }
  return null;
}

/** The refusal for an id the registry does not know, naming what IS available. @complexity O(t). */
export function unknownTargetMessage({ registry, targetId }: { registry: DeployTargetRegistry; targetId: string }, _options = {}): string {
  const ids = registry.list().map((target) => target.descriptor.id);
  if (ids.length === 0) return `publish target '${targetId.slice(0, 64)}' is not available: no publish targets are installed (turn on a hosting plugin under Agent Plugins)`;
  return `publish target '${targetId.slice(0, 64)}' is not available; choose one of: ${ids.join(", ")}`;
}

/**
 * Builds a publish config from loosely-typed input (a JSON body, a query string, a tool input):
 * `target` plus every descriptor-declared field that arrived as a string. Unknown keys are dropped,
 * so nothing a caller invents reaches a module. Whether required fields are present is judged once,
 * by {@link planStaticPublish}.
 *
 * @param required.options.blankAsAbsent - `true` for a query string or tool input, where an empty optional field
 *   means "not set"; `false` for a JSON body, which keeps it so the module can refuse it by name.
 * @returns The config, or the refusal for a declared field that arrived as a non-string.
 * @complexity O(f) declared fields.
 */
export function readStaticPublishConfig(
  { target, raw, options }: {
    target: LoadedDeployTarget;
    raw: Readonly<Record<string, unknown>>;
    options: { readonly blankAsAbsent: boolean };
  },
  _options = {},
): { readonly ok: true; readonly config: StaticPublishConfig } | { readonly ok: false; readonly message: string } {
  const config: Record<string, string> = { target: target.descriptor.id };
  for (const field of target.descriptor.configFields) {
    const value = raw[field.name];
    if (value === undefined || (options.blankAsAbsent && typeof value === "string" && value.trim() === "")) continue;
    if (typeof value !== "string") return { ok: false, message: `'${field.name}' must be a string` };
    config[field.name] = value;
  }
  return { ok: true, config: config as StaticPublishConfig };
}

/**
 * Each publish RUN gets its OWN directory under `infra/` (the Docker-volume-mounted directory every
 * other export/publish artifact already lives under) — `<parent>/<target>/<runId>`, not merely
 * `<parent>/<target>`. Exported (not merely internal) specifically so this per-run isolation is
 * directly testable.
 *
 * MEDIUM audit finding (2026-08-19, Codex sol bug/architecture audit): a fixed `<parent>/<target>`
 * directory meant two publishes overlapping for the SAME target — the admin UI and a confirmed
 * agent tool call, or two OS processes (`publish-run.ts`'s own header discloses its single-flight
 * guard is process-local only, a DELIBERATE, disclosed gap this fix closes as a side effect) — could
 * `clean:true` and rewrite the same directory out from under each other. `runId` (always a fresh
 * `input.idGen.newId()` value, minted once per {@link publishStaticSite} call) makes that
 * collision structurally impossible: no lock is needed because there is no longer anything shared to
 * lock. The directory is disposable once `exportSiteBound` returns — see
 * {@link cleanupPublishRunDir}'s own doc for why nothing downstream re-reads it from disk.
 *
 * `parent` is `RouteDeps.publishOutputRootDir` (the host publish-directory setting, then `infra/publish` —
 * mirroring `export-site.ts`'s own export-directory setting), resolved ONCE by the composition root
 * (`host src/server/runtime/composition/app.ts`/`host src/server/runtime/composition/deps.ts`) and threaded through as {@link StaticPublishInput.publishOutputRootDir}
 * (2026-08-20 RouteDeps-narrowing fix — this used to be `input.routeDeps.publishOutputRootDir`; the
 * field moved, the value and its single-resolution-point discipline did not) — never read from
 * `process.env` in this file. A test overrides it the same way it always did: by setting
 * `publishOutputRootDir` on the fake `StaticPublishInput` it constructs, not by mutating real process
 * env vars.
 * @complexity O(1) — fixed-shape path join, no I/O.
 */
export function publishOutputDir({ parent, target, runId }: { parent: string; target: StaticPublishTargetId; runId: string }, _options = {}): string {
  return path.join(parent, target, runId);
}

/**
 * Loads this workspace's registry and plans the publish against it. Every registry refusal (a plugin
 * or module that did not load) is logged, never returned: the caller's answer is about ITS target.
 * @complexity One registry load (see `loadDeployTargetRegistry`).
 */
export async function resolvePublishPlan(deps: StaticPublishDeps, input: StaticPublishInput): Promise<StaticPublishPlan> {
  let registry: DeployTargetRegistry;
  try {
    registry = await deps.loadDeployTargets({ workspaceId: input.workspaceId });
  } catch (err) {
    return { ok: false, message: `publish targets could not be loaded: ${err instanceof Error ? err.message : String(err)}` };
  }
  for (const refusal of registry.refusals) deps.warn(`[static-publish] ${refusal}`);
  return planStaticPublish({ registry, config: input.config });
}

