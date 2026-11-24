import { expectTypeOf, test } from "vitest";

import type { ExecutionCardAgent, ExecutionPort } from "../contracts/execution.js";

/**
 * @file Pins the execution-card contracts this package owns (moved from `@jini-ai/ui`'s
 * `features/execution/{types,ports}.ts`). The card's detected-CLI shape is `ExecutionCardAgent` — NOT
 * `DetectedAgent`, which already names a differently shaped agent-runtime/agent-definition type — and
 * `ExecutionPort` is the transport a host implements; drift in either fails `tsc` here.
 */
test("ExecutionCardAgent keeps the id/label/installed core and optional card fields", () => {
  expectTypeOf<ExecutionCardAgent["id"]>().toEqualTypeOf<string>();
  expectTypeOf<ExecutionCardAgent["label"]>().toEqualTypeOf<string>();
  expectTypeOf<ExecutionCardAgent["installed"]>().toEqualTypeOf<boolean>();
  expectTypeOf<ExecutionCardAgent["discoveryPending"]>().toEqualTypeOf<boolean | undefined>();
});

test("ExecutionPort.detectLocalAgents resolves a readonly ExecutionCardAgent list and rescan is optional", () => {
  expectTypeOf<ReturnType<ExecutionPort["detectLocalAgents"]>>().toEqualTypeOf<Promise<readonly ExecutionCardAgent[]>>();
  expectTypeOf<ReturnType<NonNullable<ExecutionPort["rescanLocalAgents"]>>>().toEqualTypeOf<Promise<readonly ExecutionCardAgent[]>>();
  expectTypeOf<ExecutionPort["rescanLocalAgents"]>().toEqualTypeOf<(() => Promise<readonly ExecutionCardAgent[]>) | undefined>();
});

test("ExecutionPort.testConnection resolves { ok, message? } and testAgent is optional", () => {
  expectTypeOf<ReturnType<ExecutionPort["testConnection"]>>().toEqualTypeOf<Promise<{ ok: boolean; message?: string }>>();
  expectTypeOf<ExecutionPort["testAgent"]>().not.toEqualTypeOf<undefined>();
});
