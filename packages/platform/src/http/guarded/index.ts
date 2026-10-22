export { createHttpClient, classifyAddress } from "./client.js";
export type { AddressClass } from "./client.js";
export { EgressRefusedError } from "./errors.js";
export { FetchHttpTransportAdapter } from "./transport.fetch.js";
export { createNodeGuardedHttpPorts } from "./node-ports.js";
export { guardedFetch } from "./fetch-adapter.js";
export type { GuardedFetchOptions } from "./fetch-adapter.js";
export type * from "./types.js";
export type * from "./ports.js";

export { defaultPlatformMessages } from "../../messages.js";
export type { PlatformMessages } from "../../messages.js";
