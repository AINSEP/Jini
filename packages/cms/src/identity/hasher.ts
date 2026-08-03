import * as argon2 from "argon2";

import type { PasswordHasherPort } from "./ports.js";

/**
 * @file argon2id password hashing (INV-05).
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

  constructor(options: Argon2PasswordHasherOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.options.memoryCost,
      timeCost: this.options.timeCost,
      parallelism: this.options.parallelism,
    });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Malformed/foreign hash (e.g. a hand-edited row) — fail closed, not 500.
      return false;
    }
  }
}
