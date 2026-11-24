import type { ExportReport } from "../../static-export/contracts.js";

import type { CommitFile } from "./provider-module.js";

/**
 * @file The port a site commit calls to turn a finished site export into the flat file list a
 * commit publishes. `source-control` owns the interface; the host's backup feature implements it,
 * because the portable static copy a commit publishes is the same one the backup/share download
 * builds, and that packaging code lives there. Owning the port here keeps the dependency pointing
 * one way: the backup feature imports `source-control` (it uses providers as its transport), never
 * the reverse. The composition root binds the implementation. `R` lets a host that extends the
 * export report keep its own fields on the way through.
 */

/** What `StaticSiteContextFn` resolves to: the identity the packaged copy is labelled with. */
export interface StaticSiteIdentity {
  readonly name: string;
  readonly slug: string;
  readonly theme: string;
  readonly themeId: string;
}

/** Flat commit files, or the one refusal a caller can explain to the owner: two files claiming a path. */
export type StaticSitePackage =
  | { readonly ok: true; readonly files: CommitFile[] }
  | { readonly ok: false; readonly kind: "destination-collision"; readonly message: string };

export interface StaticSitePackagerPort<R extends ExportReport = ExportReport> {
  /** The file a visitor opens first in the packaged copy. */
  readonly entryFile: string;
  /** Any failure other than a path collision is thrown unchanged. */
  packageSite(required: { report: R; site: StaticSiteIdentity }, optional?: Record<string, never>): StaticSitePackage;
}
