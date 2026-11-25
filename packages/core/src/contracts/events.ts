/** @agent-note The generic command/event/outbox vocabulary: types, plus the one runtime list `RECORDED_ACTOR_KINDS`. The gateway (`executeCommand`) lives in `@jini-ai/cms/core`. */
export type * from "./events/ports.js";
export type * from "./events/change-set.js";
export type * from "./events/command.js";
export { RECORDED_ACTOR_KINDS } from "./events/ports.js";
