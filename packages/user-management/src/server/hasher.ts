import { createRequire } from "node:module";

import type { PasswordHasherPort } from "../core/ports.js";

/**
 * @file argon2id password hashing.
 *
 * Purpose:
 * The one real `PasswordHasherPort` adapter this pass — native argon2
 * bindings, verified installable/buildable in this environment (see the
 * Programmer handoff). Raw passwords are never stored or logged; only the
 * hash produced here is persisted (`users.passwordHash`).
 *
 * Architectural role:
 * Rule-of-two candidate per feature.spec's Dependencies table — only one
 * adapter exists this pass, matching the spec's own "candidate" framing.
 * See docs/decisions/DR-001-identity-and-session-boundary.md.
 */

/** Tunable cost parameters, defaulted to OWASP's current argon2id minimums. */
export interface Argon2PasswordHasherOptions {
  /** KiB. OWASP minimum recommendation is 19456 (~19 MiB). */
  memoryCost?: number;
  /** Iteration count. OWASP minimum recommendation is 2 at this memory cost. */
  timeCost?: number;
  /** Degree of parallelism. */
  parallelism?: number;
}

/** The minimal native adapter API this implementation consumes. */
interface Argon2NativeBinding {
  argon2id: number;
  hash(password: string, options: Required<Argon2PasswordHasherOptions> & { type: number }): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

/** Binding seam; hosts may inject a native adapter or another implementation. */
export interface Argon2BindingPort {
  argon2id: number;
  hash(required: { password: string }, optional?: Argon2PasswordHasherOptions & { type?: number }): Promise<string>;
  verify(required: { hash: string; password: string }): Promise<boolean>;
}

export interface Argon2PasswordHasherDependencies {
  loadBinding: (required: Record<string, never>) => Argon2BindingPort;
}

const requirePeer = createRequire(import.meta.url);

/** Resolve the optional native peer only when this adapter is used. */
export function loadArgon2Binding(_required: Record<string, never>): Argon2BindingPort {
  const native = requirePeer("argon2") as Argon2NativeBinding;
  return {
    argon2id: native.argon2id,
    hash: ({ password }, optional = {}) => native.hash(password, { ...DEFAULT_OPTIONS, type: native.argon2id, ...optional }),
    verify: ({ hash, password }) => native.verify(hash, password),
  };
}

const DEFAULT_OPTIONS: Required<Argon2PasswordHasherOptions> = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * argon2id-backed `PasswordHasherPort`. `verify` never throws on a malformed
 * or foreign hash — it resolves `false`, so a corrupted `passwordHash` row
 * degrades to "wrong password," never to a 500 or an authentication bypass.
 *
 * @complexity O(1) calls into the native binding; cost is tuned by
 * `memoryCost`/`timeCost`/`parallelism`, not by input size.
 * @overallScore 100
 */
export class Argon2PasswordHasher implements PasswordHasherPort {
  private readonly options: Required<Argon2PasswordHasherOptions>;
  private readonly loadBinding: Argon2PasswordHasherDependencies["loadBinding"];

  constructor({ loadBinding }: Argon2PasswordHasherDependencies, options: Argon2PasswordHasherOptions = {}) {
    this.loadBinding = loadBinding;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async hash({ password }: { password: string }): Promise<string> {
    const argon2 = this.loadBinding({});
    return argon2.hash({ password }, {
      type: argon2.argon2id,
      memoryCost: this.options.memoryCost,
      timeCost: this.options.timeCost,
      parallelism: this.options.parallelism,
    });
  }

  async verify({ hash, password }: { hash: string; password: string }): Promise<boolean> {
    const argon2 = this.loadBinding({});
    try {
      return await argon2.verify({ hash, password });
    } catch {
      // Malformed/foreign hash (e.g. a hand-edited row) — fail closed, not 500.
      return false;
    }
  }
}
