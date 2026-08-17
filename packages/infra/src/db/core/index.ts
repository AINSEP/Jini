/**
 * @module @jini-ai/infra/db/core
 *
 * The driver-neutral persistence surface: ports every database driver implements, plus the
 * pure helpers those drivers share. Importing this entry point loads no native module and no
 * ORM — that is the point of the subpath split, and `pnpm guard`'s R12 check enforces it.
 *
 * Note there is no `.` export on this package. A root barrel that re-exported both this module
 * and `db/sqlite` would make every consumer load the driver regardless of which subpath they
 * asked for, because Node does not tree-shake: whatever the static import graph reaches gets
 * executed. Omitting `.` is the enforcement mechanism, not a stylistic choice.
 */
export { restorePointFilename, sanitizeForFilename } from './artifact-naming.js';
export type {
  DbOpsPort,
  RestoreCapability,
  RestoreCostClass,
  RestoreKind,
  RestorePoint,
  WatermarkReader,
} from './ports.js';
