/**
 * @module core
 *
 * The framework-free half of `@jini-ai/vibecoding`: the authoring loop and the artifact port it
 * drives. No React, no Node built-ins, no DOM — so a server, a worker or a CLI can import this
 * without acquiring a UI dependency.
 *
 * That separation is enforced by the same rule that governs the rest of this workspace, and it is
 * not theoretical: a sibling consolidation was measured and abandoned precisely because a Node
 * HTTP server imports a framework-free chat package directly, and folding a React layer into it
 * would have forced React onto that server.
 */
export type {
  ApplyOutcome,
  PartId,
  PartRef,
  Snapshot,
  ValidationResult,
} from "./types.js";
export type { EditTarget } from "./target.js";
export type { ProposedEdit } from "./apply.js";
export { applyEdit, applyEdits, correctionsFor } from "./apply.js";
