import type { Principal } from '@jini-ai/core';
import type { CreateTerminalServiceOptions, TerminalService } from '@jini-ai/core/contracts/runtime';
import { createTerminalService } from '@jini-ai/platform';
import type { WorkspaceRootResolver } from '@jini-ai/daemon/http';

/**
 * The preset's `terminal` options. Besides the three preset-owned fields, they carry the terminal
 * service's own tuning (`maxEvents` … `shutdownGraceMs`): the preset builds the service, so the
 * options that used to pass through daemon's session manager are stated here. Omitted ones keep the
 * engine's default.
 */
export type TerminalFeatureOptions = Omit<CreateTerminalServiceOptions, 'loadSpawnPty'> & {
  /** Host-selected PTY implementation; the native adapter is at `@jini-ai/server/adapters/node-pty`. Without one, `create()` rejects with guidance. */
  readonly loadSpawnPty?: CreateTerminalServiceOptions['loadSpawnPty'];
  /**
   * A service the host built itself (the guidance below names this option). It is used as given: `loadSpawnPty` and the
   * tuning options configure the service the preset would otherwise build, so they have no effect beside it.
   */
  readonly terminalService?: TerminalService;
  readonly resolveWorkspaceRoot?: WorkspaceRootResolver;
  readonly principal?: Principal;
};

/** Boot stays inert without a host-selected PTY: the first `create()` rejects with this guidance (the host opts in explicitly, never by default). */
function inertPtyLoader(): never {
  throw new Error('Interactive terminals require a host-supplied terminalService or loadSpawnPty. Import loadRealSpawnPty from @jini-ai/server/adapters/node-pty to enable node-pty.');
}

/** The tuning keys the preset forwards to the service; an explicit `undefined` never overrides the engine's default. */
const TERMINAL_TUNING_KEYS = ['maxEvents', 'maxBufferBytes', 'exitTailBytes', 'flushIntervalMs', 'flushThresholdBytes', 'ttlMs', 'shutdownGraceMs'] as const;

/** The host's service when it gave one; otherwise one built from the host's loader (or the inert one) plus only the tuning that was given. `createService` is the engine's builder, injectable so a test can record what it receives. */
export function buildTerminalService(
  { options }: { options: TerminalFeatureOptions },
  { createService = createTerminalService }: { createService?: typeof createTerminalService } = {},
): TerminalService {
  if (options.terminalService !== undefined) return options.terminalService;
  const tuning = Object.fromEntries(TERMINAL_TUNING_KEYS.filter((key) => options[key] !== undefined).map((key) => [key, options[key]]));
  return createService({ loadSpawnPty: options.loadSpawnPty ?? inertPtyLoader, ...tuning });
}
