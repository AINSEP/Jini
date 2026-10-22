export interface GlueFieldDecl { readonly path: string; readonly type: 'string' | 'integer' | 'number' | 'boolean' }
export type GlueContentLifecycleFilter = (required: {
  entry: Readonly<Record<string, unknown>>;
  ctx: { readonly moduleId: string; readonly workspaceId: string };
}) => Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>;
export interface GlueToolRegistration {
  readonly toolId: string;
  readonly handler: (required: Readonly<Record<string, unknown>>, optional?: Readonly<Record<string, unknown>>) => unknown;
}
export type GlueChangeSetCommand = unknown;

/** Host implementations own persistence, containment and dispatch. Mounting tools must be atomic. */
export interface GlueHostPort {
  attachContentLifecycleFilter(required: { moduleId: string; filter: GlueContentLifecycleFilter; declaredFields: readonly GlueFieldDecl[] }): void;
  registerTools(required: { moduleId: string; registrations: readonly GlueToolRegistration[] }): void;
  subscribeEvent(required: { moduleId: string; eventName: string; handler: (required: { payload: unknown }) => Promise<void> | void }): void;
  registerAdminNav(required: { moduleId: string; payload: Readonly<Record<string, unknown>> }): void;
  contributeRender(required: { moduleId: string; payload: Readonly<Record<string, unknown>> }): void;
  registerHttpRoute(required: { moduleId: string; payload: Readonly<Record<string, unknown>> }): void;
  runChangeSet(required: { command: GlueChangeSetCommand }): Promise<unknown>;
  snapshotBlob(required: { content: Uint8Array | string }): Promise<{ readonly hash: string }>;
  restoreBlob(required: { hash: string }): Promise<Uint8Array>;
}
export type { GlueCallSite, GlueCapability } from './manifest.js';
