declare module "@jini-ai/plugin-sdk" {
  export const HOOK_CONTENT_ENTRY_BEFORE_SAVE: string;
  export function definePlugin(definition: {
    setup(sdk: {
      addFilter(name: string, filter: (
        entry: Readonly<import("@jini-ai/core/contracts/plugin-sdk").ContentEntryDraft & { title: string; bodyJson: unknown; metaDescription?: unknown }>,
        ctx: import("@jini-ai/core/contracts/plugin-sdk").HookContext,
      ) => import("@jini-ai/core/contracts/plugin-sdk").ExtPatch | Promise<import("@jini-ai/core/contracts/plugin-sdk").ExtPatch>): void;
    }): void;
  }): { definition: typeof definition };
}
