import assert from "node:assert/strict";
import { test } from "vitest";

import * as corePgTypes from "../../core/pg-types.js";
import * as postgres from "../../postgres/index.js";
import * as postgresTypes from "../../postgres/types.js";
import * as recovery from "../../recovery/index.js";
import { resolveDeepLinkContext } from "../../recovery/deep-link.js";
import { resolveDegradedBanner } from "../../recovery/degraded-banners.js";
import { computeDisclosure } from "../../recovery/disclosure.js";
import { evaluateBootMigrationPolicy } from "../../recovery/evaluate-boot-migration-policy.js";
import { AlwaysUnavailableWatermarkSource, RestorePointDeepLinkLookup } from "../../recovery/lookup-adapters.js";
import { executeMigrateForward } from "../../recovery/migrate-forward-execute.js";
import { buildMigrateForwardHooks } from "../../recovery/migrate-forward-hooks.js";
import { createOperationLock } from "../../recovery/operation-lock.js";
import { reconcileInterruptedMigrationOnBoot } from "../../recovery/reconcile-interrupted-migration.js";
import { confirmRestore, executeRestore, planRestore } from "../../recovery/recovery-orchestrator.js";
import { buildRestoreHooks, RestorePointNotFoundError, toRecoveryResult } from "../../recovery/restore-hooks.js";
import { createRestorePoint } from "../../recovery/restore-point-create.js";

/**
 * @file The `./postgres` and `./recovery` entry points are re-export barrels: each must hand a
 * consumer the very implementation its source module defines, not a copy or a stale twin.
 */

test("the postgres entry and its compatibility path re-export core's pg type policy unchanged", () => {
  assert.equal(postgres.pgTypesFor, corePgTypes.pgTypesFor);
  assert.deepEqual(Object.keys(postgresTypes).sort(), Object.keys(corePgTypes).sort());
  for (const name of Object.keys(corePgTypes) as Array<keyof typeof corePgTypes>) assert.equal(postgresTypes[name], corePgTypes[name], name);
});

test("the recovery entry exposes each recovery module's own implementation", () => {
  const expected: Record<string, unknown> = {
    resolveDeepLinkContext,
    resolveDegradedBanner,
    computeDisclosure,
    evaluateBootMigrationPolicy,
    AlwaysUnavailableWatermarkSource,
    RestorePointDeepLinkLookup,
    executeMigrateForward,
    buildMigrateForwardHooks,
    createOperationLock,
    reconcileInterruptedMigrationOnBoot,
    planRestore,
    confirmRestore,
    executeRestore,
    buildRestoreHooks,
    RestorePointNotFoundError,
    toRecoveryResult,
    createRestorePoint,
  };
  const exported: Record<string, unknown> = { ...recovery };
  for (const [name, implementation] of Object.entries(expected)) assert.equal(exported[name], implementation, name);
});
