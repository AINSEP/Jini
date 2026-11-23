/**
 * @file Boot-time `declareDataModule()` invocation for Comments' 2-table manifest (ADR-023 §2,
 * SPEC-032/SPEC-033). Mirrors the host's newsletter data-module install
 * exactly — idempotent (skip-if-existing-tables), throws on failure so the caller (composition
 * root, via the ADR-046 Phase 2 boot lifecycle) surfaces it as a startup failure rather than
 * silently continuing with missing tables.
 */
import { declareDataModule, type DataModuleStore } from "@jini-ai/db/data-modules";
import { commentsDataModule, type CommentsDataModuleProvenance } from "./types.js";

export async function installCommentsDataModule(
  required: { db: DataModuleStore; dbPath: string; provenance: CommentsDataModuleProvenance },
  _optional: Record<string, never> = {}
): Promise<void> {
  const { db, dbPath, provenance } = required;
  const result = await declareDataModule({ db, dbPath, decl: commentsDataModule({ provenance }) });
  if (!result.ok) {
    throw new Error(`comments dataModule declaration failed: ${result.error?.code} — ${result.error?.message}`);
  }
}
