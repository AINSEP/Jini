/**
 * @file The same-origin gate seam for route tests.
 *
 * Routes reach the gate through `guardSameOrigin` from `@jini-ai/core/contracts/server` — the
 * daemon's own handlers and http-kit's `mountJsonRoute` alike. Since wave B moved the guard into
 * core, it calls `isLocalSameOrigin` through a core-internal relative import, so mocking
 * `isLocalSameOrigin` on the `@jini-ai/core` barrel no longer reaches it. A test file instead
 * spies on the guard where the code under test imports it:
 *
 *   vi.mock('@jini-ai/core/contracts/server', async (importOriginal) => {
 *     const actual = await importOriginal<typeof import('@jini-ai/core/contracts/server')>();
 *     return { ...actual, guardSameOrigin: vi.fn(() => actual.ok({ value: undefined })) };
 *   });
 *
 * and toggles it with the two helpers below. The rejecting path runs the REAL guard, so a 403
 * assertion still proves core's decision and its FORBIDDEN answer, not a canned error.
 */
import { vi } from 'vitest';
import { guardSameOrigin, ok } from '@jini-ai/core/contracts/server';

const actual = await vi.importActual<typeof import('@jini-ai/core/contracts/server')>('@jini-ai/core/contracts/server');

/** The spied guard, for one-off implementations (e.g. a guard that throws). */
export function sameOriginGuard(_required = {}, _optional = {}) {
  return vi.mocked(guardSameOrigin);
}

/** Every request passes the gate: the tests' request literals carry no Host or Origin header. */
export function allowSameOrigin(_required = {}, _optional = {}): void {
  sameOriginGuard().mockImplementation(() => ok({ value: undefined }));
}

/** Core's real guard decides. A header-less test request has no local Host, so it is rejected. */
export function rejectCrossOrigin(_required = {}, _optional = {}): void {
  sameOriginGuard().mockImplementation(actual.guardSameOrigin);
}
