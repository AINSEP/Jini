/**
 * `@jini-ai/core` DI token for this package's one composable service, per
 * extraction-plan §2.2 ("Kernel exports only kernel-service tokens... every
 * other token lives in its owning feature package") and following the
 * `XToken` naming precedent set by `packages/daemon/src/tokens.ts`. A pack's
 * `cli` registrar (`Pack['cli']` in `packages/core/src/pack.ts`) resolves
 * this token to get the concrete `CommandRegistry` it registers its own
 * subcommands against.
 */
import { token } from '@jini-ai/core';
import type { CommandRegistry } from './command-registry.js';

export const CommandRegistryToken = token<CommandRegistry>('jini.cli.commandRegistry');
