---
"@jini-ai/mcp": patch
---

Add a stable `./bin` export subpath resolving to the `jini-mcp` executable.

The package declared a `bin` entry for `dist/bin/serve.js` but an `exports` map containing only
`"."`, so a consumer that needed the executable's path in order to spawn it as a CLI-injected MCP
server could not ask for one: `require.resolve('@jini-ai/mcp/dist/bin/serve.js')` fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED`. Consumers were resolving the root export and walking to a sibling
path by hand, hardcoding this package's private build layout.

`require.resolve('@jini-ai/mcp/bin')` now returns that path directly. The subpath deliberately
declares only a `default` condition — it is meant to be resolved to a path and handed to `spawn`,
not imported (`serve.ts` uses top-level await behind its `isMainModule` guard, so it is not
`require()`-able). Purely additive: the `"."` export is unchanged.
