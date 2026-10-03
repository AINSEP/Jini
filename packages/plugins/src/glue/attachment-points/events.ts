import type { GlueHostPort } from "../ports.js";

export interface SubscribeGlueEventRequired {
  readonly moduleId: string;
  readonly eventName: string;
  readonly handler: (required: { payload: unknown }) => Promise<void> | void;
  readonly hostPort: Pick<GlueHostPort, "subscribeEvent">;
}

export type SubscribeGlueEventOptional = Record<string, never>;

export function subscribeGlueEvent(
  required: SubscribeGlueEventRequired,
  _optional: SubscribeGlueEventOptional = {}
): void {
  const { moduleId, eventName, handler, hostPort } = required;
  hostPort.subscribeEvent({ moduleId, eventName, handler });
}
