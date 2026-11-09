/**
 * @file Public entry `@jini-ai/integrations/credentialed-http/sets`: credential-set validation and
 * CRUD over a host-supplied vault, plus the host-input contracts it needs.
 *
 * @agent-note A second host wires this entry by supplying EVERY product value; none has a default:
 * - `CredentialSetVaultPolicy`: the trusted owner key (rows carry null principal/binding), the
 *   complete-shape metadata parser its vault service uses, the label order, the raw label-conflict
 *   error its storage raises, and `vaultErrors` returning/recognizing the host's ONE canonical vault
 *   error class per code (never a new class here).
 * - `CredentialSetStoreHost`: categories (stored `category` strings are kept byte-for-byte), scope
 *   policy (site first, then a granted project half), create target, UNIQUE/create-conflict
 *   classifiers, token normalization + secret-free field checks, works-for normalization, the vault
 *   opener (authorizes the full expected context before any seal/open), and all wording verbatim.
 * - Metadata reads never decrypt; resolve opens only the selected, authorized row with the metadata
 *   read in the same pass. Writes are compare-and-swap on the stored revision inside the host's
 *   transaction, preserve the stored kind (legacy `custom` envelopes keep authenticating) and never
 *   serialize the private vault context. `allowSharedKeyReplacement` is trusted host input, never
 *   model input. The error classes exported here are the canonical ones; a host shim must re-export
 *   these same objects rather than subclass or copy them.
 */
export * from "./host.js";
export * from "./vault-repo.js";
export * from "./store.js";
