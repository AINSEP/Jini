/**
 * @file `@jini-ai/cms/core` — the framework-free kernel of the CMS capability.
 *
 * ## What belongs here
 *
 * Everything that must run in any JavaScript runtime: the shared runtime ports (clock, id
 * generation, outbox, domain events), the auditable mutation write path, and the tool-registration
 * kit every domain's agent-tool layer builds on. No Express, no `node:*`, no DOM, no concrete
 * adapters.
 *
 * ## What belongs in `../server`
 *
 * Only the Node-bound half: concrete repository implementations (SQLite/Postgres), filesystem blob
 * stores, and anything importing `node:*`.
 *
 * ## Why the split is drawn here, and why it is enforced by `exports` rather than convention
 *
 * This mirrors a defect measured in the CMS runtime this is ported from. There, the content model
 * and its HTTP composition root lived in one `src/` tree with no enforced boundary, and 53 import
 * edges ended up pointing *into* the composition root — including 22 domain modules importing a
 * 454-line route-deps type whose first line was `import type { Express } from "express"`. The
 * consequence, visible in git history, was that no content module could be changed without also
 * changing the server: its theme module and its server co-changed in 71% of commits touching the
 * former.
 *
 * A package's `exports` map is exactly the enforcement a single `src/` tree cannot provide: a
 * consumer of `@jini-ai/cms/core` physically cannot reach a Node adapter, and `/core` physically
 * cannot import a transport type, because the module resolver refuses it. Keep it that way — if a
 * core module wants something from `/server`, the dependency is pointing the wrong way and the fix
 * is a port (interface) in core, not a widened export.
 *
 * ## Why the barrel does not re-export `./commands/appliers`
 *
 * There is no `appliers` module here, and that is deliberate rather than an oversight. In the
 * source repo the equivalent barrel re-exported an inverse-applier registry that named two specific
 * content features by import. Because every domain's tool layer reaches the kernel, that single
 * re-export put a dependency on those two features into every domain module in the tree — the
 * measured reason no domain could be extracted on its own. A per-entity applier registry belongs
 * behind a registration call the host makes, not behind a kernel barrel.
 */

export type {
  UUID,
  ISODateTime,
  JsonPrimitive,
  JsonValue,
  JsonObject,
  JsonArray,
  DomainEvent,
  EventBusPort,
  OutboxRecord,
  OutboxPort,
  ClockPort,
  IdGeneratorPort,
} from './ports.js';

export type {
  ChangeSetStatus,
  ChangeSetOperation,
  ChangeSetRecord,
  ChangeSetItemRecord,
  ChangeSetWithItems,
  ChangeSetRepoPort,
} from './commands/change-set.js';

export * from './commands/command.js';
export * from './tools/registration-kit.js';
