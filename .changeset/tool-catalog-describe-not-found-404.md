---
"@jini-ai/http-kit": minor
---

`GET /api/tools/:id` answers 404 for an unknown tool id, not 400.

`toolCatalogDescribeRoute` (the route `@jini-ai/mcp`'s `describe_tool` proxies) reported a
well-formed request naming a nonexistent catalog entry as `VALIDATION_FAILED` / **400**, because its
`handle` reached for the same `validationError` helper its `parse` step uses — where 400 genuinely is
correct. The result was that a caller could not tell "you sent a malformed request" apart from "that
tool does not exist", which are the two things a status code is supposed to separate.

The three sibling route families in this package with the identical "the referenced resource isn't
there" case — `memory.ts`'s `memory not found`, `routines.ts`'s `routine not found`, and `media.ts`'s
`media task not found` — all already answered 404. This was the one family out of step, so this is a
behavior correction toward an existing in-package convention rather than a new one.

Now `NOT_FOUND` / **404**, with the message unchanged (`no catalog entry for tool id "<id>"`).
`parse` failures on this route — a missing `:id` path segment — are still 400.

**Behavior change for callers**, hence the minor bump: anything that branched on 400 to detect an
unknown tool id must branch on 404 instead. Client code that only distinguishes success from failure
is unaffected. A wire-level test now pins the observed status code for the not-found case, the
malformed case, and the cross-origin case, so the two cannot silently converge again.
