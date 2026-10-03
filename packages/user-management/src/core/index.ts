/** Universal identity records, errors, ports, and permission vocabulary. */
// Consumers use this public entry for universal contracts rather than deep imports. Keeping the
// concrete hasher behind the server entry prevents a native binary from becoming a prerequisite
// for importing identity types or permission vocabulary; PasswordHasherPort is the shared contract.
export * from "./types.js";
export * from "./ports.js";
export * from "./runtime-ports.js";
export * from "./permissions.js";
