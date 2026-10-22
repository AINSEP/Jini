Spec ID: SPEC-JINI-ARTIFACTS-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:b7af4dfe26c323454401866eb36fb3972efd92faa390981de5aef9ebb00a3082
spec_mode: reverse_spec


# Behavior contract: artifacts

## Manifest precedence and bounds

- WHEN resolving a manifest, the store shall use a non-null supplied manifest before the inferrer. IF neither supplies a truthy manifest, THEN it shall reject. Empty default taxonomy shall refuse kind/renderer/export membership.
- WHEN validating, the validator shall accept null as no manifest, require nonempty exports, enforce taxonomy membership and preserve export order without deduplication.
- The validator shall bound kind/renderer at 64 characters, title at 200, source context ID at 128, paths at 260, supporting paths at 128 items and serialized metadata at 16384 UTF-8 bytes. It shall reject absolute drive/POSIX paths, NUL, `..` substrings and `.` segments. These are lexical checks, not filesystem containment.
- WHEN stamping, the sanitizer shall use version 1, default status `complete`, fallback title equal to entry, preserve string `createdAt`, and refresh `updatedAt` unless preservation is requested. Timestamp strings are not parsed or validated.
- WHEN parsing persisted JSON, the parser shall require version 1 and return null on validation, parsing or serialization failure. Direct validation can throw on non-JSON metadata such as cycles/BigInt.

## Store and guards

- WHEN creating, the in-memory store shall validate and decode before replacing the name's map entry. It shall default to UTF-8 and sort list results by descending `updatedAt` string. It shall neither copy returned records/bytes nor impose storage quotas.
- WHEN checking publication, the guard shall match case-sensitive configured substrings in strings or UTF-8 bytes, preserve marker declaration order and scan only configured kinds in the assertion function. Empty default config shall block nothing.
- WHEN composing runtime normalizers, the package shall pass each output to the next in supplied order. The default shall return the original body. The store shall not automatically call publication/stub guards or normalizers.
- WHEN classifying regression, the guard shall choose the largest prior (first input wins equal sizes), ignore prior sizes below the minimum, and pass at exactly the retained-ratio threshold. Defaults: warn, 20% retention, 4096 prior bytes, `.html`/`.htm` extensions. Reject mode returns a verdict; it does not throw.
- WHEN matching identifiers, the package shall accept literal equality or equality where one side is the other's nonempty canonical slug. Two different raw names sharing a truncated slug shall not be treated as identical. Slugs shall be lowercase ASCII `[a-z0-9_-]`, capped at 60.
- WHEN scanning disk, the Node adapter shall include the current filename before overwrite, prefer a usable sidecar identifier over filename inference, ignore nonfiles/unreadable entries and return no priors for unreadable directories. Scan failures therefore do not fail closed.

## Streaming and publication behavior

The suppressor retains potential tag tails (search window 512 characters), counts hidden segments and flushes visible pending text; flush while suppressing discards the candidate and leaves suppression active. XML-like matching is case-insensitive and not a nesting-aware XML parser. Each stream needs its own instance; caller regexes must have predictable `exec` behavior.

Complete and split tagged blocks shall be suppressed while preserving visible prefixes and suffixes; sequential blocks shall retain correct open/close and suppressed-character counts. Recursive processing uses the same object-argument contract as external calls.

Publication guards decode Uint8Array content (including Buffer subclasses) with universal TextDecoder, preserving leading UTF-8 BOMs and replacement decoding of malformed bytes. The guard does not import Node built-ins. The package supplies no renderer, execution sandbox, publication workflow, disk artifact store, retry or request-idempotency service.

Evidence: manifest/store/guards/text-suppression source and corresponding source tests, read without execution.
