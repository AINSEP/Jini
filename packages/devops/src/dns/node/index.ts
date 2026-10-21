/**
 * `@jini-ai/devops/dns/node` — the `node:dns` authoritative resolver for the DNS kernel, kept off
 * the pure `./dns` entry so planning and verification never pull in sockets.
 */
export * from './resolver.js';
export * from './udp.js';
export * from './wire.js';
