/** Provider id -> saved custom API-key label. Only declared bindings may supply a commit fallback;
 * explicit source-control connections always win. */
export const sourceControlSavedApiKeyLabels: ReadonlyMap<string, string> = new Map([["github", "github"]]);
