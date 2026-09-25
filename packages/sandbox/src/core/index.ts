/**
 * @module @jini-ai/sandbox/core
 *
 * The backend-neutral execution surface: the port every sandbox adapter implements, plus the
 * types that cross it. Importing this entry point loads no adapter — `pnpm guard`'s R12 check
 * enforces that against every optional peer this package declares.
 *
 * Note there is no `.` export on this package. A root barrel that re-exported both this module
 * and an adapter would make every consumer load that adapter regardless of which subpath they
 * asked for, because Node does not tree-shake: whatever the static import graph reaches gets
 * executed. Omitting `.` is the enforcement mechanism, not a stylistic choice.
 *
 * `SandboxOperationError` is a real runtime export (a class, defined in `errors.ts`), not a
 * type — everything else here erases at compile time. See its doc comment for why a ports
 * module needs one, and why it lives in its own file rather than in `ports.ts`.
 */
export { SandboxOperationError } from './errors.js';
export type { SandboxErrorCategory } from './errors.js';
export type {
  BootOptions,
  CommandResult,
  FileChangeEvent,
  FileChangeKind,
  PreviewTarget,
  ProcessHandle,
  ProcessOutputChunk,
  RunCommandOptions,
  SandboxFile,
  SandboxProviderPort,
  SandboxSession,
  Unsubscribe,
} from './ports.js';
