import type { GlueContentLifecycleFilter, GlueFieldDecl, GlueHostPort } from "../ports.js";

export interface AttachGlueContentLifecycleRequired {
  readonly moduleId: string;
  readonly filter: GlueContentLifecycleFilter;
  readonly declaredFields: readonly GlueFieldDecl[];
  readonly hostPort: Pick<GlueHostPort, "attachContentLifecycleFilter">;
}

export type AttachGlueContentLifecycleOptional = Record<string, never>;

export function attachGlueContentLifecycle(
  required: AttachGlueContentLifecycleRequired,
  _optional: AttachGlueContentLifecycleOptional = {}
): void {
  const { moduleId, filter, declaredFields, hostPort } = required;
  hostPort.attachContentLifecycleFilter({ moduleId, filter, declaredFields });
}
