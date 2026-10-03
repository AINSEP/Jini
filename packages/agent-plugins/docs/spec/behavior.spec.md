Spec ID: SPEC-JINI-AGENT-PLUGINS-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:097e378800c2b2c53e65beedf57e26894482a158d80b5a9c94a54cce838340f4
spec_mode: reverse_spec


# Behavior Rules: Agent Plugins

## Manifest parsing and trust

- WHEN using root guards, the package shall check only an object with a nonblank string name, or an object with a non-array `mcpServers` object. These guards do not enforce the standard schema, name grammar, or server-field types.
- WHEN parsing lifecycle manifests, the package shall require the exact version 1.0.0 schema URL and a 1–64-character name matching `^[a-z0-9]+(?:[-.][a-z0-9]+)*$`. Unknown top-level fields generate warnings; malformed optional strings are omitted and keywords retain only string entries.
- WHEN parsing MCP configuration, the package shall require the exact MCP schema URL and server map, preserve all declared server ids, and include only structurally parsed servers in `servers`. Invalid individual entries are omitted while the top-level result can still be `ok: true`.
- IF stdio configuration sets `PLUGIN_ROOT` or `PLUGIN_DATA` in `env`, THEN that entry shall be omitted. Stdio commands are classified `requires-confirmation`; HTTP/SSE servers are classified `auto-admit`. These labels do not launch or authorize a server.
- WHERE namespaced remote metadata is supplied, the parser shall validate auth mode, default tool lists, token-auth URLs/environment names, and rename mappings. Tool lists/maps are capped at 64; names are 1–64 allowed characters; token URLs require HTTPS and at most 2048 characters; retired-env lists are capped at 32. Rename targets cannot be identities or keys in the same mapping. The remote server's own URL only requires a nonempty string; egress and URL validity remain host responsibilities.
- WHEN loading executable contributions, the discovery helper shall require a shipped digest match and, if `requireActive` is true, an active verdict. Inactive plugins are omitted with optional observer notification; unreadable decisions produce refusals.

## Fetch and installation

- WHEN fetching archives, the package shall accept absolute HTTP/HTTPS URLs, request manual redirects, guard each destination before requesting it, and enforce at most 11 requests in the redirect loop. The fetch port must honor manual redirects; connection-time DNS pinning is host-owned.
- The fetcher shall cap both declared and actual bytes at 32 MiB, allow a smaller positive integer cap, reject empty bodies, compute SHA-256, and cancel the response reader in its cleanup. No timeout is supplied automatically; the caller supplies an abort signal or bounded fetch adapter.
- WHEN installing, the package shall verify a lowercase 64-hex expected digest before extraction, reuse an already published digest directory, and reject traversal/absolute/NUL paths, duplicate normalized entries, links, devices, FIFOs, excessive entries, and excessive extracted bytes.
- The installer shall cap the archive at 32 MiB, entries at 4096, each file at 16 MiB, and total extracted bytes at 64 MiB. Declared-size limits and streamed-byte limits are separate checks.
- WHEN publication succeeds, directories and executable files shall be chmod'd to `0555`, other files to `0444`; the result shall list files lexically and skills by name. Publication uses rename and extraction cleanup runs in `finally`. Filesystem/permission/cleanup errors can propagate after publication; the operation is not a transaction across every host effect.
- WHEN packing a bundled source directory, the package shall sort regular-file paths and serialize deterministic bytes with the supplied magic prefix; the packer shall refuse more than 2048 files. This is a private deterministic framing, not ZIP, and skips symlink entries rather than packaging them.

## Activation, selection, and ordering

- WHEN resolving a plugin for execution, the package shall reject an inactive or undetermined activation, a missing package, ambiguous digests without a usable bundled preference, or a missing same-named skill. Reference order determines prompt section order; one refusal prevents returning any combined prompt.
- WHERE delivery mode is `inject`, the package shall read `skills/<pluginId>/SKILL.md` and include other-file inventory. WHERE mode is `pointer`, it shall check the indexed skill and emit the host pointer text without reading the markdown.
- WHEN multiple installed digests share an id and the ledger's bundled digest is present, selection shall retain that digest. A ledger entry that is not installed does not resolve ambiguity.
- WHEN ranking local candidates, the package shall tokenize case-insensitive whitespace-separated terms and score substring matches with weights id 5, keywords 4, description 2, skill 1. Positive scores sort descending; ties preserve input order; blank queries return empty; limits are clamped below at zero. It does not filter disabled candidates or score MCP ids.
- WHEN seeding bundles, the package shall preserve operator decisions, record successful shipped digests, then attempt retirements. Enabled seed ids and old-to-successor mappings come from the host. Per-plugin failures are results; ledger failure is separately reported.
- WHEN uninstalling, the package shall reject unknown or bundled plugins unless the explicit retirement override applies. An optional confirmed preview compares current archive digests; without it there is no confirmation gate. Package trees are staged out of discovery before activation deletion, and staged trees are restored on a pre-commit failure. Final deletion failure can leave quarantine trees after the activation has been removed.

## Scope and known source limitations

The package does not provide a marketplace, version resolver, secrets vault, principal authorization, content sandbox, worker scheduler, automatic MCP federation, UI mounting, or automatic execution of bundled skill scripts. Containment helpers operate on trusted package handles; `readTrustedPluginFile` and `importContainedModule` do not independently re-check shipped-digest trust. Dynamic module import runs in-process.

The installer currently ignores `bytesWritten` returned by its injected file handle. Adapters must complete each chunk write; a partial-write adapter can publish incomplete file content. Declared file size is checked against its cap, not compared for exact equality with streamed bytes. Permission changes happen after rename; a race that reuses an existing directory is not a byte-for-byte re-verification. These are source limitations, not promised security guarantees.

The malformed-entry uninstall refusal interpolates the host-supplied product name. Consumers should identify the error class rather than depending on that message fragment.

Evidence: `src/lifecycle/{manifest,fetch-archive,install,activation,bundled-digests,resolve-agent-plugin-refs,search,trusted-plugin-files,seed-bundled,retire-bundled,uninstall}.ts`; inspected tests exercise archive bounds, repeat installation, containment, activation corruption, operator choices, previews, and rollback.
