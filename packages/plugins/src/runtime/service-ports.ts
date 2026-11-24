/** Consumer-owned service boundaries for plugin execution. */

/** Reads a required post, preserving the post owner's existing not-found error. */
export interface PluginPostReadPort<Post> {
  readRequired(input: { workspaceId: string; id: string }, options?: Record<string, never>): Promise<Post>;
}

/** Provider/assistant-face relationships and safe linked-switch error details. */
export interface PluginProviderFacesPort {
  /** A provider switch covers itself and its linked assistant faces. Used only by explicit OFF. */
  affectedPluginIds?(input: { pluginId: string }, options?: Record<string, never>): Promise<readonly string[]>;
  linkedProvider(input: { pluginId: string }, options?: Record<string, never>): Promise<string | undefined>;
  /** Safe preflight refusal, formatted by the same owner as linked-switch errors. */
  describeLinkedFace(input: { pluginId: string; providerPluginId: string }, options?: Record<string, never>): { code: string; message: string; providerPluginId: string };
  describeLinkedError(input: { error: unknown }, options?: Record<string, never>): { code: string; message: string; providerPluginId: string } | undefined;
  /** A "Soon" Agent Plugin is locked off by the host's soon-lock: the refusal to show before
   *  any confirmation, or undefined when it may be switched on. */
  describeNotReady?(input: { pluginId: string }, options?: Record<string, never>): Promise<{ code: string; message: string } | undefined>;
}
