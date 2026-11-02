# Primitives, HTTP API, and Models reference

Everything below is quoted or directly restated from `docs.typesafe.ai`'s `introduction.md`,
`primitives.md`, `primitives/choice.md`, `primitives/score.md`, `primitives/noul.md`,
`primitives/advanced.md`, `api.md`, and `models.md` (crawled 2026-09-21). Read the live docs if
anything here looks out of date. TypeSafe ships new model versions on its own schedule.

## Endpoint

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

### Request body (top level, all required)

| Field | Type | Notes |
|---|---|---|
| `state` | `string \| object \| array` | The content every question in this request is evaluated against. See "State format" below. |
| `model` | `string` | e.g. `"jev-latest"`. See "Models, aliases, and versions." |
| `questions` | `map<string, Question>` | Key is your own id — chosen by your code, **never sent to the model, never used in inference**. Write the complete question in `instructions` even if the id looks self-explanatory. |

### Response body (top level, all required)

| Field | Type | Notes |
|---|---|---|
| `model` | `string` | The concrete, versioned model that actually answered (e.g. `"jev-1.13.0"`), even if the request's `model` field was an alias. |
| `answers` | `map<string, Answer>` | Keyed by the same ids you sent in `questions`. |
| `usage` | `{ input_tokens: integer, output_tokens: integer }` | Token accounting for the whole request (all questions combined), used for billing. |

### Errors

| Status | Meaning | What to do |
|---|---|---|
| `401 Unauthorized` | Missing or invalid API key. | Check the `Authorization` header. |
| `422 Unprocessable Entity` | Request body failed validation (missing required field, malformed question). The body details the offending field. | Fix the request; don't retry unchanged. |
| `429 Too Many Requests` | Rate limit exceeded. | Retry with exponential backoff; honor `retry-after` if present. SDKs do this by default. |
| `529 Overloaded` | TypeSafe is temporarily overloaded. | Retry after a short delay, with backoff. |

## State format

| Format | Useful for | Example |
|---|---|---|
| String | A message, article, or passage | `"My card was charged twice."` |
| Object | Named fields, related records, or application state | `{"message": "...", "order_id": "A-104"}` |
| Array | A sequence of messages or records | `["Hi", "My customer number is TS1337.", "My card was charged twice."]` |

- Text only — string, JSON object, or array of text values. No image, audio, or video input.
- English is the primary training language and currently the most accurate. Other languages,
  including CJK scripts, are accepted but less accurate — test on real content before relying on
  Jev for a non-English workload.
- Prefer an object over a bare string for most requests, so parts of the state have descriptive
  names a question can reference (see "Referencing nested state" below).
- Use an object, not a giant string, when you can — it composes with per-question structure and lets
  you filter irrelevant fields out in code (see jaggedness #5, large/irrelevant state hurts accuracy).

## Question types — full field reference

Every question shares this shape: an id (your key, not sent to the model), `type`, `instructions`
(required on all three), and `criteria` (required for Choice and Score, optional for Noul).

### Choice

```json
{ "type": "choice", "instructions": <EntryType>, "criteria": { "<option>": <EntryType|null>, ... } }
```

- `criteria` is a **required** map: option name → description. A description of `null` is valid when
  the option name is self-explanatory (e.g. `{"calm": null, "frustrated": null, "angry": null}`).
- **Maximum 255 options.** Each option adds only a few tokens, so give the full list of teams,
  categories, or products rather than a shortlist. Add an `other` / `none of the above` option when
  the list might not cover every input.
- Answer: `{ "type": "choice", "choice": "<winning option>", "confidence": <0-1>, "probabilities": { "<option>": <0-1>, ... } }` — `probabilities` sums to 1 across every option; `choice` is the
  highest-probability option; `confidence` is derived from how peaked/flat that distribution is.

### Score

```json
{ "type": "score", "instructions": <EntryType>, "criteria": [<EntryType>, <EntryType>, ...] }
```

- `criteria` is a **required, ordered array** of level descriptions, low end of the scale first.
  **At least 2 levels, at most 10.** Levels are 0-indexed by array position. The model is given only
  the description text for each level and judges each independently — it does not see the level
  number or its neighbors.
- Use as many levels as you can describe distinctly; three is fine. Don't add levels you can't
  describe distinctly — plain numeric levels (`["0", "1", "2"]`) measurably perform worse than
  described ones for the same input (docs show a same-input comparison: descriptive levels →
  score 0.0 at confidence 1.0; numeric-only levels → score 0.55 at confidence 0.33).
- Answer: `{ "type": "score", "score": <number>, "confidence": <0-1>, "legend": { "<index>": "<description>", ... }, "probabilities": { "<index>": <0-1>, ... } }`.
  **`score` formula:** the probability-weighted mean of level indices — `Σ(level_index ×
  probability[level_index])`. It can therefore land between two levels (e.g. `1.43` between levels 1
  and 2); do not treat `score` as an exact measurement interpolated within a level (jaggedness #2).
- To split a complex judgment into several Score questions and recombine: normalize each score to
  0–1 by dividing by `len(criteria) - 1` (the top level index), then combine with weights you own in
  code (composite scoring — see `patterns.md`).
- Structured level descriptions (an object per level, e.g. `{what: ..., examples: [...]}`) can
  materially change `score`/`confidence` when the example matches the real input — the docs show the
  same input scoring `1.43`/`0.35` with a plain-string level vs. `1.03`/`0.96` once a matching
  example was added to that level's description.

### Noul

```json
{ "type": "noul", "instructions": <EntryType>, "criteria": { "true": <EntryType>, "false": <EntryType> } }
```

- `criteria` is **optional** — an object clarifying what "yes" and "no" mean for ambiguous
  boundaries. Omit it when the question is unambiguous.
- Answer: `{ "type": "noul", "noul": <0-1> }` — the probability the answer is yes. **No `confidence`
  field** (a two-outcome distribution is already fully described by one number).
- `noul` is a probability of "yes," not a scale of the thing you asked about — it is not directly
  comparable to a Score's `score` value for the same underlying question (docs show a 4-row example
  where Noul values 0.03/0.14/0.81/0.92 line up with Score values 0.0/1.0/2.05/2.89 for parallel
  questions on the same 4 inputs — not linearly related).
- Threshold guidance: use 0.5 when acting on a false yes and missing a true yes cost about the same;
  raise the threshold when a false yes is expensive, lower it when missing a true yes is expensive.
  A "don't know" band (e.g. `0.2 < noul < 0.8`) can route ambiguous cases to human review while still
  surfacing the raw probability.
- Phrase the question so a "yes" answer is unambiguous — `criteria.true`/`criteria.false` exist
  specifically for the cases where that's not obvious from the instructions alone.

### Structured `instructions`/`criteria` (`EntryType`)

`instructions`, Choice's per-option `criteria` values, Score's per-level `criteria` entries, and
Noul's `criteria.true`/`criteria.false` all accept the same shape — `EntryType` = `string | object |
array | null` — not just plain text.

- Use structure when it adds clarity (a multi-part question) or when the question needs supporting
  data that's already JSON (a schema, a taxonomy node, a database row) — pass that JSON directly, or
  the relevant subfields, rather than string-templating it into prose.
- Field names inside a structured value are **not part of the API and none are reserved** — you
  choose them (docs use examples like `question`, `focus`, `what`, `not_for`, `examples`), and the
  model sees the field names along with the values.
- Reference a specific part of `state` from inside `instructions` with a backtick dot/index path,
  e.g. `` `ticket.messages[0].text` ``.
- **Walking a taxonomy:** for a deep classification tree, ask one Choice per level, with the current
  node's children as `criteria` keys and their **subtrees** as the option values (not just a
  description) — this lets the model see what's under each branch before committing. If a branch is
  too large, trim its value to direct children plus a sample of leaves.

## Batching questions in one request

- All three types can be mixed freely in one `questions` map.
- Every question in a request is evaluated **in parallel and in isolation** against the same
  `state`. Adding questions barely changes response time and costs only the extra tokens for the
  added question text.
- Only split into two sequential requests when code genuinely cannot construct the second request
  until it has read the first response (e.g. rank-then-verify over a large candidate set — see
  `cookbooks.md`'s "Skill suggestion" and "Structure recovery" entries, and "Hierarchical
  classification" for beam search over sequential per-level requests).

## Models, aliases, and versions

| Field | Value |
|---|---|
| Current model | `jev-1.13.0` (the only model family as of this writing) |
| Price | $42 per billion input tokens ($0.042 / million). **Output tokens are free.** |
| Rate limits | 250,000 tokens/second, 1,200 requests/minute — **stated as adjusting dynamically and subject to change without notice** as TypeSafe scales capacity. Higher limits available on custom/enterprise plans (`sales@typesafe.ai`). |
| Context length | 64k tokens per request (`state` + every question combined); 32k tokens for `state` plus the single longest question. |
| Input | Text only (string / JSON object / array of text). No image, audio, or video. |

**Aliases:**

| Alias | Points to (currently) | Meaning |
|---|---|---|
| `jev-latest` | `jev-1.13.0` | Most recent **stable, official** release. SDK default; what these docs' examples use. |
| `jev-preview` | `jev-1.13.0` | Most recent release, official or not — moves ahead of `jev-latest` when a preview build exists. Currently identical to `jev-latest`; no preview build is live right now. |

An alias moves when TypeSafe ships a new release, so answers behind it can change without any change
on your side. The response's `model` field always reports the concrete versioned id that answered.
**If you've tuned confidence thresholds against a specific version, pin that version's id instead of
an alias.**

`GET /v1/models` lists available `model` names (the aliases) with a description and release date —
`{"models": [{"name": string, "description": string, "release_date": string}, ...]}`. Versioned ids
like `jev-1.13.0` are always accepted by the `model` field whether or not they're listed there.

**Customization:** Jev is not fine-tuned or LoRA-adapted per customer — the same weights serve every
account. It's trained with RLCD (reinforcement learning for calibrated decisions — see TypeSafe's
"AI primer" for how this differs from optimizing for generated text). Customization happens entirely
through how you shape the request: `state` content, `instructions`/`criteria` wording, and how you
decompose and recombine questions in code — not through any per-account training.

**Data handling:** Jev is not trained on customer requests or responses. Zero data retention (ZDR)
is available for enterprise customers — see TypeSafe's `/legal` for the DPA and privacy policy.
