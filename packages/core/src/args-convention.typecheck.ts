/** Compile-time rejection of legacy arguments; intentionally not executed at runtime. */
import { apiTokenFromEnv, bindings, createDaemon, createToolRegistry, definePack, token, ToolInputError } from './index.js';
import type { ToolHandler } from './index.js';

// @ts-expect-error Token IDs are required object properties.
token<string>('legacy');
// @ts-expect-error Token versions belong in the optional object.
token<string>({ id: 'legacy', version: 2 });
// @ts-expect-error Empty factories still require an object.
bindings();
// @ts-expect-error Required and optional pack fields must be separated.
definePack({ name: 'legacy', deps: [], services: () => ({}), tools: () => [] });
// @ts-expect-error Optional transport metadata is not a required daemon field.
createDaemon({ packs: [], bindings: bindings({}), transports: [] });
// @ts-expect-error Environment dependencies must be supplied explicitly.
apiTokenFromEnv({ config: { tokenEnvVar: 'TOKEN', disableEnvVar: 'DISABLE' } });
// @ts-expect-error Error messages are named required args.
new ToolInputError('legacy');

const registry = createToolRegistry({});
// @ts-expect-error Registry IDs are named required args.
registry.has('legacy');
// @ts-expect-error Enumeration takes an empty required object.
registry.list();

const handler: ToolHandler = async () => undefined;
handler({
  executionId: 'example', principal: { id: 'example' }, run: { id: 'example' },
  input: {}, signal: new AbortController().signal,
  // @ts-expect-error Optional emitter belongs in the second handler argument.
  emitSurface: async () => {},
});

// New subpaths follow the same convention as the existing kernel APIs.
import {
  createContributionRegistry, ForbiddenError, InMemoryTokenStore, PlanStaleError,
  TokenAlreadyRedeemedError, TokenExpiredError, UnauthenticatedError, WorkspaceMismatchError,
} from './index.js';
import type { AuthorizeFn, GatedMutationHooks } from './index.js';

import type { Clock, IdGenerator } from './primitives/index.js';

const contributions = createContributionRegistry({ keyOf: ({ contribution }: { contribution: string }) => contribution });
// @ts-expect-error Enumeration requires an object, even with no values.
contributions.list();
// @ts-expect-error Clearing requires an object.
contributions.clear();
// @ts-expect-error The adapter constructor requires an object.
new InMemoryTokenStore();
const tokens = new InMemoryTokenStore({});
// @ts-expect-error Count requires an object.
tokens.count();
// @ts-expect-error Error messages are required object properties.
new TokenExpiredError('legacy');
// @ts-expect-error Error messages are required object properties.
new TokenAlreadyRedeemedError('legacy');
// @ts-expect-error Error messages are required object properties.
new PlanStaleError('legacy');
// @ts-expect-error Error messages are required object properties.
new UnauthenticatedError('legacy');
// @ts-expect-error Error messages are required object properties.
new WorkspaceMismatchError('legacy');
// @ts-expect-error Reason codes are required object properties.
new ForbiddenError({ message: 'legacy' });

function checkApprovalPorts(required: {
  clock: Clock; ids: IdGenerator; hooks: GatedMutationHooks<unknown, unknown>; authorize: AuthorizeFn;
}): void {
  required.clock.nowMs();
  // @ts-expect-error Zero-argument clock getter does not accept an object.
  required.clock.nowMs({});
  required.ids.newId();
  // @ts-expect-error Zero-argument ID getter does not accept an object.
  required.ids.newId({});
  // @ts-expect-error Plan hooks require an object.
  required.hooks.computePlan();
  required.authorize({ principalId: 'principal', permission: 'read', workspaceId: 'workspace' }, { entityId: 'entity' });
  required.authorize({ principalId: 'principal', permission: 'read', workspaceId: 'workspace',
    // @ts-expect-error Optional entity selectors belong in the second object.
    entityId: 'entity',
  });
}
void checkApprovalPorts;
