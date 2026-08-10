/**
 * `MediaPolicy` — a host-injected gate on media generation. Generalized from
 * OD's `apps/daemon/src/media/policy.ts`, which is a thin wrapper
 * around `@open-design/contracts`'s `MediaExecutionPolicy`/
 * `mediaExecutionPolicyDenial` (that package is OD-owned and out of scope
 * for this engine package). The underlying evaluation logic itself carries
 * no OD-specific moderation content or thresholds — it is a plain
 * enabled/disabled + surface/model allowlist gate — so it ports as generic
 * data + a pure evaluator, redefined locally rather than imported. A host
 * that needs real content-moderation rules (NSFW classifiers, per-tenant
 * quotas, etc.) implements `MediaPolicy` itself; `createAllowlistMediaPolicy`
 * is the reference implementation proving the port's shape, not a
 * moderation engine.
 */
import type { MediaSurface } from './types.js';

export type MediaExecutionMode = 'enabled' | 'disabled';

export type MediaPolicyDenialCode = 'MEDIA_EXECUTION_DISABLED' | 'MEDIA_SURFACE_DENIED' | 'MEDIA_MODEL_DENIED';

/** What a caller is asking permission to do. */
export interface MediaPolicyTarget {
  readonly surface: MediaSurface;
  readonly model?: string;
}

export interface MediaPolicyDenial {
  readonly code: MediaPolicyDenialCode;
  readonly message: string;
}

/** Declarative shape for `createAllowlistMediaPolicy` — an allowlist gate, not the only possible `MediaPolicy` implementation. */
export interface MediaExecutionPolicy {
  readonly mode: MediaExecutionMode;
  readonly allowedSurfaces?: readonly MediaSurface[];
  readonly allowedModels?: readonly string[];
}

// SEC-RB-010: deny by default. A host must explicitly opt into `mode:
// 'enabled'` (and, if it cares about restricting models, explicitly supply
// `allowedModels`) rather than getting an unrestricted default merely by
// not passing a policy at all — media generation is a real-money, costly
// capability, not something that should be on by default.
export const DEFAULT_MEDIA_EXECUTION_POLICY: MediaExecutionPolicy = { mode: 'disabled' };

/**
 * Host-injected policy port. `@jini-ai/integrations/media-providers` never calls this itself — a
 * caller (a pack's app-service, a tool handler) evaluates a target before
 * dispatching generation and honors a non-null denial.
 */
export interface MediaPolicy {
  evaluate(target: MediaPolicyTarget): MediaPolicyDenial | null;
}

/**
 * Reference `MediaPolicy`: an enabled/disabled + surface/model allowlist
 * gate, ported verbatim from the origin's `mediaExecutionPolicyDenial`. A
 * missing/empty `allowedSurfaces`/`allowedModels` means "no restriction on
 * that dimension" (matches the origin's `Array.isArray(...) && length > 0` guard).
 */
export function createAllowlistMediaPolicy(policy: MediaExecutionPolicy = DEFAULT_MEDIA_EXECUTION_POLICY): MediaPolicy {
  return {
    evaluate(target: MediaPolicyTarget): MediaPolicyDenial | null {
      if (policy.mode === 'disabled') {
        return { code: 'MEDIA_EXECUTION_DISABLED', message: 'media generation is disabled for this run' };
      }
      if (policy.allowedSurfaces && policy.allowedSurfaces.length > 0 && !policy.allowedSurfaces.includes(target.surface)) {
        return { code: 'MEDIA_SURFACE_DENIED', message: `media surface "${target.surface}" is not allowed for this run` };
      }
      // SEC-RB-010: a model allowlist must not be bypassable by omitting the
      // model field. If the host restricted models at all, an unspecified
      // (or blank-after-normalization) model can't be verified against that
      // allowlist and must be denied, not silently waved through.
      const normalizedModel = target.model?.trim();
      if (policy.allowedModels && policy.allowedModels.length > 0) {
        if (!normalizedModel || !policy.allowedModels.includes(normalizedModel)) {
          return {
            code: 'MEDIA_MODEL_DENIED',
            message: `media model ${normalizedModel ? `"${normalizedModel}"` : '(none specified)'} is not allowed for this run`,
          };
        }
      }
      return null;
    },
  };
}
