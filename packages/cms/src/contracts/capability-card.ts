import type { GuideTopic } from "@jini-ai/core/contracts/site/agentic-core";

/**
 * The learning card a feature owner ships beside its code. It is the structural port that
 * `@jini-ai/agentic`'s site-guide `GuideTopic` implements: cms owns the shape it fills in, agentic
 * keeps consuming it, and neither package imports the other.
 */
export type CapabilityCard = GuideTopic;
