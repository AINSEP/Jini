/**
 * @module @injini/mcp/server
 * Sub-barrel for the MCP tool-hosting mechanism: the pure tool protocol
 * layer (`tool-protocol.ts`), the pure resource protocol layer
 * (`resource-protocol.ts`), the daemon transport (`daemon-client.ts`), the
 * `Server`/`StdioServerTransport` wiring (`tool-server.ts`), the concrete
 * kernel-run tool defs (`tools/run-tools.ts`), the concrete kernel
 * resource defs (`resources/active-resource.ts`), and the delegated-tool
 * execution def (`tools/delegated-tool.ts`).
 */
export * from './tool-protocol.js';
export * from './resource-protocol.js';
export * from './daemon-client.js';
export * from './tool-server.js';
export * from './tools/run-tools.js';
export * from './tools/delegated-tool.js';
export * from './resources/active-resource.js';
