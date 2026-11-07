/**
 * @file Public surface of `@jini-ai/agent-plugins/lifecycle/host-tools`: the host-facing Agent Plugin
 * tools that stay inside one domain (the skill tool, plugin search, plugin memory tools, write-note
 * and provider status). Anything that crosses domains or shows a card lives in
 * `@jini-ai/server/agent-plugin-host` instead.
 *
 * The entry exists before its contents so the export resolves; each tool arrives with the batch that
 * moves it, reaching the host through ports, never an import of a same-layer package.
 */
export {};
