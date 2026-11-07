/**
 * @file Public surface of the command gateway module (ADR-018).
 *
 * The admin mutation write path: `executeCommand` records an auditable,
 * revertible change set; `revertChangeSet` undoes one via the inverse-applier
 * registry. Adapters implement `ChangeSetRepoPort`.
 */
export * from "../index.js";
export * from "./appliers.js";
export * from "./revert.js";
export { InMemoryChangeSetRepo } from "./repo.memory.js";
