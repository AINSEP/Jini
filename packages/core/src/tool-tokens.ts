/**
 * `@jini-ai/core` DI token for `ToolRegistry` — defined alongside the service
 * it names, per this package's own composition contract (`token.ts`) and
 * mirroring `@jini-ai/daemon/src/tokens.ts`'s identical rationale for
 * `RunLifecycle`/`EventLog`: a kernel-service token lives in the package
 * that owns the service, not in a central registry.
 */
import { token } from './token.js';
import type { ToolRegistry } from './tool-registry.js';

export const ToolRegistryToken = token<ToolRegistry>('jini.toolRegistry');
