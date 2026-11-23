import { SqlWorkspaceRepo, type WorkspaceSqlRequired } from "../sql/repo.js";

/** The site profile owns the persisted table name. */
export const WORKSPACE_TABLES = { workspaces: "workspaces" } as const;

/** Derives the schema-erased storage kernel from whatever handle the host holds (its kernel or its db). */
export type WorkspaceKernelFor<TStore> = (required: { store: TStore }) => WorkspaceSqlRequired["kernel"];

/**
 * @file The workspace repo on a site's SQLite `content.db`. The one Kysely query body lives in Jini
 * `@jini-ai/cms/workspace/sql`; this named class keeps the composition root that builds it from the content db handle.
 *
 * The host's content kernel and its db handle stay host types: the host passes its handle as `store`
 * and its own kernel eraser as `kernelFor`, so this module names neither.
 */
export class SqliteWorkspaceRepo<TStore> extends SqlWorkspaceRepo {
  /** The connection's kernel, or the content db handle it is derived from. */
  constructor({ store, kernelFor }: { store: TStore; kernelFor: WorkspaceKernelFor<TStore> }, _optional: Record<string, never> = {}) {
    super({ kernel: kernelFor({ store }), tables: WORKSPACE_TABLES }, {});
  }
}
