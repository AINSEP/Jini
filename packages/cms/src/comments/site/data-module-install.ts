/**
 * @file Boot-time `declareDataModule()` invocation for Comments' 2-table manifest (ADR-023 §2,
 * SPEC-032/SPEC-033). Mirrors the host's newsletter data-module install
 * exactly — idempotent (skip-if-existing-tables), throws on failure so the caller (composition
 * root, via the ADR-046 Phase 2 boot lifecycle) surfaces it as a startup failure rather than
 * silently continuing with missing tables.
 */
import { commentsDataModule, type CommentsDataModuleProvenance } from "./types.js";

/** The comments manifest as `commentsDataModule()` builds it. */
export type CommentsDataModuleDecl = ReturnType<typeof commentsDataModule>;

/**
 * The host's data-module installer (its database kernel's `declareDataModule`), injected so this
 * package depends on no database package. `TStore` is the host kernel's store handle, passed through.
 */
export type DeclareCommentsDataModule<TStore> = (args: { db: TStore; dbPath: string; decl: CommentsDataModuleDecl }) =>
  Promise<{ ok: boolean; error?: { code?: string; message?: string } | undefined }>;

export async function installCommentsDataModule<TStore>(
  required: { db: TStore; dbPath: string; provenance: CommentsDataModuleProvenance; declareDataModule: DeclareCommentsDataModule<TStore> },
  _optional: Record<string, never> = {}
): Promise<void> {
  const { db, dbPath, provenance, declareDataModule } = required;
  const result = await declareDataModule({ db, dbPath, decl: commentsDataModule({ provenance }) });
  if (!result.ok) {
    throw new Error(`comments dataModule declaration failed: ${result.error?.code} — ${result.error?.message}`);
  }
}
