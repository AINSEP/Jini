Spec ID: SPEC-JINI-MEMORY-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:be0dd31e0c864bad99c8bc1bf1d00c856f5c7f34e1bb03eb70be532c44a090c1
spec_mode: reverse_spec


# Behavior contract: memory

## Notes

- The store shall use the consumer's type taxonomy; it shall substitute `defaultType` for unreadable/missing stored types. Construction does not validate taxonomy consistency; callers must supply safe type strings and include the default in `validTypes` if it must appear in the tree.
- WHEN constructed, the store shall reject unsafe `subdir` segments; the default is `notes`, with a 128-character maximum. Entry IDs shall match `[a-z0-9_]+` and be at most 96 characters.
- WHEN filesystem operations resolve the store, the store shall check real-path containment under `dataDir`. Reads shall skip nonregular entry files. Config reads shall reject nonregular files and non-missing failures; only `ENOENT` defaults to enabled.
- WHEN config JSON parses, the store shall return enabled unless `enabled === false`; it shall not enforce a complete JSON schema. The enabled flag is metadata: individual CRUD methods do not enforce it.
- WHEN writing a file, the store shall use exclusive temporary creation, file sync, close and rename. This is per-file atomicity; entry/index updates are separate writes with no cross-file transaction or writer lock.
- WHEN upserting, the store shall write the entry, update the active index, read the entry back, then emit `change` unless silent. Reusing an ID overwrites and reactivates the entry. It shall not provide request idempotency or collision-proof IDs.
- WHEN listing, the store shall sort by descending file modification time. Active entries shall be the intersection of readable entries and valid index links, in that same order. Tree folders shall follow `validTypes`; empty-folder times use epoch zero.
- WHEN an event listener throws, the store shall swallow the exception; later listeners in that emission are not guaranteed to run. Config events shall occur only when enabled changes.

## Parsing, extraction and verification

- The frontmatter parser shall read only flat `name`, `description`, `type` lines; an absent block shall yield empty fields and preserve the raw body. Rendering shall flatten LF/CRLF in fields and trim leading body whitespace.
- WHEN parsing rule bodies, the parser shall take the first nonempty recognized label; assertion falls back to the first trimmed body line and check falls back to assertion.
- WHEN content is blank, extraction shall return `{ facts: [], raw: '' }` without networking or log creation. Otherwise it shall preserve candidate order, drop unusable statements, trim strings, clamp finite confidence to `[0,1]` and cap the result.
- The default fact cap shall be 20. Positive finite `maxFacts` shall be floored, including fractions below one, which produce a zero cap. Suggested categories shall be prompt hints, not validation rules. Extraction shall neither deduplicate facts nor persist them.
- WHEN logging extraction success, the pipeline shall record candidate count as `writtenCount` with no written IDs; this is not evidence that storage succeeded. Draft names shall be capped at 80 characters.
- WHEN calling an LLM, the primitive shall require nonblank credentials/model and use a 30-second abort signal unless a positive finite timeout is supplied. It shall make one HTTP attempt and perform no retry, scheduling, secret lookup or model selection. Anthropic requests shall cap tokens at 1024.
- Required HTTP init fields shall override `requestInit`. Required header keys shall override identically spelled extra keys; case-variant header keys are not normalized here. JSON parsing shall tolerate wrapping fences and a surrounding object block; it shall not validate the returned generic type.
- WHEN enforcing verification, the package shall skip in order: disabled, no rules, no artifact. Missing scorecards shall report all rules uncovered. Each row shall cover at most one rule, using greedy input order and substring/two-significant-word matching.
- IF a row status is not exactly `pass` or `fail`, THEN verification shall count it as failed. Any failed row or uncovered rule shall yield fail; top-level scorecard status is informational.

## Known implementation limits

Fact extraction rejects a JSON `null` response with `Error('extract-facts: response must not be null')` and marks a configured extraction attempt failed before rethrowing. Missing/non-array facts still produce an empty result. Verification expects typed row objects; its fail-closed status rule is not a validator for arbitrary row shapes.

Evidence: note-store, extract-facts, llm-provider and verify source; matching tests under `src/__tests__/`. No UI, vector search, autonomous extraction worker, account lifecycle or cross-process synchronization is supplied.
