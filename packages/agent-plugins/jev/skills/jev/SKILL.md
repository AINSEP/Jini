---
name: jev
description: Design and write code that calls Jev, TypeSafe's System One model — a fast, non-generative model that turns state plus a typed Choice/Score/Noul question into a typed answer with a calibrated probability distribution. Use this for classification, routing, scoring, ranking, extraction-by-selection, and confidence-gated automation; not for generating prose. Covers the three primitives' exact request/response shapes, confidence, the documented patterns, known jev-1.13 limitations, and the HTTP API / JavaScript SDK. This plugin declares no MCP server — nothing here lets the assistant call Jev directly in chat.
---

# Jev (TypeSafe System One)

## The one thing to say before anything else

**This plugin has no MCP server.** `mcp.json` declares `"mcpServers": {}` on purpose. Jev has no
official MCP server, and TypeSafe's docs index lists no MCP integration. There
is no `mcp__jev__*` tool, and enabling this plugin does not let the assistant call the Jev API
during a chat turn. What this skill is for: **helping design and write code** — a host product feature, a
script, a separate service — that calls Jev itself, over plain HTTP or the JavaScript SDK. If an
operator asks "can you check with Jev right now," the honest answer is no, not yet; what you can do
is write the code that will.

**The API key goes in `TYPESAFE_API_KEY`, never in chat.** That's the env var TypeSafe's SDKs read
by default. The JS SDK also accepts an explicit `new TypeSafeClient({ apiKey })`, and that value takes
precedence over the env var, so a key loaded from a secret store works too. Whoever sets up the
integration puts the key in the environment or a secret store, the same way any other API credential
belongs in this codebase. Never ask for it in chat, never paste one into code you write, and never
echo one back if a user pastes it anyway. Tell them to treat it as compromised and rotate it at
TypeSafe's dashboard (`console.typesafe.ai/keys`).

---

## What Jev is

Jev is TypeSafe's flagship model and the first "System One" model: instead of generating text, it
takes a **state** (the content to reason about — a string, JSON object, or array of text) and one or
more typed **questions**, and returns a typed **answer** per question with a calibrated probability
distribution. All questions in one request are evaluated in parallel, independently, against the
same state — asking more questions barely changes response time. It is served at one HTTP endpoint,
`POST https://api.typesafe.ai/v1/systemone`, and there are official Python and JavaScript SDKs.
Jev currently accepts **text input only** — no images, audio, or video — and its primary training
language is English; other languages (including CJK scripts) are accepted but currently less
accurate.

## When Jev fits

Jev is for judgments with a **bounded, structured answer space** over content you hand it directly:

- **Classification / routing** — which team, which intent, which handler should this go to (Choice).
- **Scoring / rubrics** — how severe, how frustrated, how relevant, on a rubric you define (Score).
- **Yes/no gating** — is this urgent, does this need a human, does this contain X (Noul).
- **Ranking / re-ranking** — score each candidate independently, sort by the returned probability.
- **Extraction by selection** — find candidates with code (regex, retrieval), have Jev pick which one
  answers the question, then copy that value verbatim — never have it generate the value.
- **Confidence-gated automation** — act automatically above a threshold, ask for confirmation in the
  middle, and route to a human below it; see [Confidence](#confidence) below.
- **A cheap feature layer in front of classical ML** — turn free text into structured Score/Noul
  columns for a downstream model, rather than hand-writing feature extraction.

## When Jev does not fit

- **Generating prose, summaries, or free text.** Jev is not trained to generate text. "You can force
  it to by chaining choices, [but] this will not work well and will be very slow" (jaggedness #9).
  Use a generative LLM for that half of the workflow, and Jev for the structured judgments around it.
- **Exact arithmetic, counting, or date/time math.** "Jev is not a calculator." It does not count
  reliably (characters, occurrences, list length), performs worse on numeric/hex/RGB/binary
  representations than semantic ones, and reads dates as text, not as ordered quantities. Do the math
  in code; ask Jev only for the judgment calls code cannot make (see
  [references/jaggedness.md](references/jaggedness.md), items 2–3).
- **Deep multi-hop or "property of a property" reasoning.** Instructions with double negatives or
  several hops of indirection are answered less reliably. Decompose into direct, atomic questions and
  combine them in code instead (jaggedness #4).
- **Anything needing images, audio, or video.** Text only, today.
- **A decision where getting fooled by adversarial input is unacceptable, without hardening it
  first.** "State is data, and jev-1.13 does not treat it as hostile by default" — content written to
  steer the model can move the answer. Be explicit in criteria and test before trusting it at scale
  (jaggedness #6).
- **Non-English content where accuracy is critical**, without testing first — accuracy is currently
  lower outside English.

When in doubt, read [references/jaggedness.md](references/jaggedness.md) before designing a new
question — it is the single most load-bearing reference here for "will this actually work well."

---

## The three primitives

Every question has an **id** (your key — never sent to the model; write the full question in
`instructions` even if the id looks self-explanatory), a **`type`**, `instructions`, and `criteria`.
Full field-by-field reference, including the "structured `instructions`/`criteria`" mechanism (every
one of these fields accepts a string, object, array, or `null`, not just plain text) is in
[references/primitives-reference.md](references/primitives-reference.md).

| Type | Answers | Request `criteria` | Answer fields |
|---|---|---|---|
| **Choice** | Which of these options? | Required map: option name → description (`string\|object\|array\|null`). Max **255** options. | `choice` (winning option), `probabilities` (map, sums to 1), `confidence` |
| **Score** | Where on this rubric? | Required ordered array of level descriptions, low → high. Min 2, max **10** levels. | `score` (probability-weighted mean of level index — can land between levels), `legend`, `probabilities`, `confidence` |
| **Noul** | Is this true? | Optional `{true, false}` clarification. | `noul` only — probability the answer is yes, 0 to 1. **No `confidence` field.** |

One combined example (request and response both real, quoted from the docs — a Choice, a Score, and
a Noul batched into one call):

```json
// POST https://api.typesafe.ai/v1/systemone
// Authorization: Bearer <TYPESAFE_API_KEY>
// Content-Type: application/json
{
  "state": "Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP.",
  "model": "jev-latest",
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this",
      "criteria": { "billing": "Payment or subscription issues", "technical": "Bugs or integration problems", "sales": "Pricing or account questions" }
    },
    "frustration": {
      "type": "score",
      "instructions": "How frustrated the customer appears",
      "criteria": ["Calm, just stating facts", "Frustrated but civil", "Very angry, strong language"]
    },
    "is_urgent": { "type": "noul", "instructions": "The message conveys urgency or time-sensitivity" }
  }
}
```

```json
// response
{
  "model": "jev-1.13.0",
  "answers": {
    "department": { "type": "choice", "choice": "technical", "confidence": 0.78, "probabilities": { "technical": 0.85, "sales": 0.0, "billing": 0.15 } },
    "frustration": { "type": "score", "score": 1.0, "confidence": 1.0, "legend": { "0": "Calm, just stating facts", "1": "Frustrated but civil", "2": "Very angry, strong language" }, "probabilities": { "0": 0.0, "1": 1.0, "2": 0.0 } },
    "is_urgent": { "type": "noul", "noul": 1.0 }
  },
  "usage": { "input_tokens": 392, "output_tokens": 65 }
}
```

Note the request sent `model: "jev-latest"` (an alias) and the response reports the concrete
resolved version, `"jev-1.13.0"`. See [Cost, latency, and limits](#cost-latency-and-limits).

**Batch, don't chain.** Put every question a workflow might need — including ones that only matter
for some inputs — into one request (the "speculative fan-out" pattern below); evaluating them is
parallel, so extra questions cost little latency and only the tokens for the extra text. Only split
into two sequential requests when code genuinely cannot build the second request until it has the
first answer (see [references/patterns.md](references/patterns.md)).

## Confidence

`confidence` (0 to 1) is on every Choice and Score answer, derived from the shape of `probabilities`
— **Noul has no `confidence`**, since a yes/no distribution is already fully described by the single
`noul` value. TypeSafe does not publish the exact formula ("a convenient measure that fits most
use-cases... you are never locked into our definition" — use `probabilities` directly for a custom
statistic). Use it as a second axis alongside the answer itself, in three bands:

- **High** → act automatically.
- **Medium** → proceed with caution — confirm, flag, or gather more information.
- **Low** → do not act — route to a human, ask a clarifying question, or fall back.

There is no universal threshold; the docs' own worked examples use different cutoffs per action
based on the cost of being wrong (a low-stakes balance check acts at 0.5+, a high-stakes transfer
approval waits for >0.9). Start conservative, test against your own data, and put the threshold
constants in one place in your code so they're easy to review — see
[references/patterns.md](references/patterns.md) for the confidence-gated-routing pattern with a
worked example.

If you only need the single best option, read the Choice answer's `choice` field, which is already
the highest-probability option. Don't compare it against a fixed threshold. A threshold decides
*whether to act*, not which option wins. For your own statistic, use `probabilities`.

## Patterns

Four named patterns, each with a worked example, are documented in
[references/patterns.md](references/patterns.md):

| Pattern | What it does | Why |
|---|---|---|
| **Speculative fan-out** | Send every question a workflow might need in one call; let code decide what's relevant after. | Parallel evaluation makes extra questions nearly free. |
| **Confidence-gated routing** | Use `confidence` as a second axis, with a different floor per action based on its stakes. | Reliability, safety. |
| **Composite scoring** | Split one complex judgment into several independent Score questions, normalize, combine with code-owned weights. | Auditability — you can see exactly how the final number was built, and reuse the same raw scores with different weights for different downstream decisions. |
| **Intent routing** | Use Jev as a cheap up-front classifier that sends each request to deterministic code, a specialist LLM, or a human. | Cost, speed — most requests never need an expensive model call. |

## Known limitations (jev-1.13 jaggedness)

TypeSafe publishes a dated list of known failure modes for the current model version, each with a
"do this instead." Full detail, including worked examples, is in
[references/jaggedness.md](references/jaggedness.md); the headline ones, worth internalizing before
writing any question:

1. **Literal reading** — answers the question you wrote, not the one you meant. Be exact; put
   boundary cases in `criteria`.
2. **Not a calculator** — counting, numeric/hex/RGB comparisons, and interpolating an exact number
   from a Score are all unreliable. Do math in code.
3. **Dates are read as text**, not ordered quantities — extract the parts with a bounded Choice, do
   date arithmetic in code.
4. **Indirection costs accuracy** — double negatives and multi-hop "property of a property" questions
   degrade. Ask directly.
5. **Large, mostly-irrelevant state hurts accuracy** — "Jev suffers from context rot" when `state`
   carries content the question doesn't need. (This is a different claim from "more questions don't
   cost accuracy," which is about batching questions, not about bloating shared state — both are true,
   they are not in tension.) Filter in code before sending, or use a Noul as a relevance pre-filter.
6. **State is not treated as adversarial by default** — content written to steer the model can move
   the answer. Be explicit in criteria; test before trusting it at scale.
7. **Contradictory instructions and criteria degrade the answer** — keep them aligned.
8. **No guaranteed structural invariants** — a Noul and an equivalent Choice can disagree; a Noul and
   its logical negation are not guaranteed to sum to 1. Don't assume arithmetic identities across
   separate questions, and don't reuse a confidence threshold tuned on one question type for another.
9. **Not built to generate text** — use Choice over a bounded option set instead of forcing free-text
   generation.

## Cost, latency, and limits

Everything here is stated by TypeSafe's docs directly, not estimated (see
[references/primitives-reference.md](references/primitives-reference.md) for the full Models-page
table):

- **Current model:** `jev-1.13.0`. Aliases: `jev-latest` (most recent *stable* release — the SDK
  default) and `jev-preview` (most recent release, stable or not; currently identical to
  `jev-latest`). The response's `model` field always reports the resolved versioned id — pin that id
  instead of an alias once you've tuned confidence thresholds against it, since an alias can move
  answers out from under you when TypeSafe ships a new release.
- **Pricing:** $42 per billion input tokens ($0.042 / million). **Output tokens are free**. `usage`
  still reports `output_tokens`, but only input tokens are billed.
- **Latency:** the only figure TypeSafe states directly is "most queries complete in about 100 ms."
  TypeSafe's own cookbooks measured 111–114 ms for a multi-question batched call, consistent with
  that figure.
- **Context limits:** 64k tokens per request (`state` + every question combined); 32k tokens for
  `state` plus the single longest question.
- **Rate limits:** 250,000 tokens/second, 1,200 requests/minute — TypeSafe states these are adjusting
  dynamically as demand grows and may change without notice; a `429` means back off and retry with
  exponential backoff (SDKs do this by default).
- **Errors:** `401` bad/missing key, `422` invalid request body, `429` rate-limited, `529`
  TypeSafe-side overload.

## Calling Jev: HTTP or the JavaScript SDK

**HTTP**, directly:

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TYPESAFE_API_KEY>
Content-Type: application/json
```

Body: `{ "state": ..., "model": "jev-latest", "questions": { "<id>": { "type": ..., "instructions": ..., "criteria": ... } } }`.
Response: `{ "model": ..., "answers": { "<id>": {...} }, "usage": { "input_tokens": ..., "output_tokens": ... } }`.
Full field reference and the error table are in
[references/primitives-reference.md](references/primitives-reference.md).

**JavaScript SDK** (`@typesafe-ai/sdk`, requires Node 20+):

```sh
npm install @typesafe-ai/sdk
```

```ts
import { choice, score, noul, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient(); // reads TYPESAFE_API_KEY from the environment

const response = await client.systemOne({
  state: { document: "I was charged twice. Please fix this ASAP." },
  questions: {
    category: choice("What is this ticket about?", { billing: null, technical: null, other: null }),
    frustration: score("How frustrated the customer appears", [
      "Calm, just stating facts",
      "Frustrated but civil",
      "Very angry, strong language",
    ]),
    billing: noul("Is this about billing?"),
  },
});

console.log(response.answers.category.choice, response.answers.frustration.score, response.answers.billing.noul);
```

The helpers are documented on the SDK reference pages as `choice(instructions, criteria)`,
`score(instructions, criteria)` (an ordered array, at least two levels) and
`noul(instructions?, criteria?)` (optional `{ true, false }`). `model` is optional on `systemOne()`.
It falls back to the client's default model, which is `jev-latest` unless configured. Retries are
on by default. Config options, retry defaults, error classes, and the one browser-safety flag are in
[references/javascript-sdk.md](references/javascript-sdk.md). Check it before you invent an option
name.

## Cookbooks

TypeSafe publishes worked, benchmarked cookbooks for common shapes — self-consistency, re-ranking,
semantic search, structure recovery, function calling, skill suggestion, entity alignment, RAG
passage classification, citation verification, LLM guardrails, extraction cascades, date extraction,
value extraction, hierarchical classification, feature discovery, and confidence-based classification.
Short digests of all 18, with their measured numbers and the one generalizable lesson from each, are
in [references/cookbooks.md](references/cookbooks.md) — read the relevant one before designing a
workflow that looks similar; it often shows a better decomposition than a first-pass design would.

## References

- [references/primitives-reference.md](references/primitives-reference.md) — full field-by-field
  reference for Choice/Score/Noul/structured questions, the HTTP API, and the Models/pricing/limits
  table.
- [references/patterns.md](references/patterns.md) — the four named patterns with worked examples.
- [references/jaggedness.md](references/jaggedness.md) — all 9 known jev-1.13 failure modes with
  mitigations. Read this before designing a new question.
- [references/javascript-sdk.md](references/javascript-sdk.md): JS SDK client config and env vars,
  question helpers, retry defaults, and error classes, each checked against the SDK reference pages.
- [references/cookbooks.md](references/cookbooks.md) — digests of all 18 published cookbooks.
- TypeSafe's own docs are the live source of truth and move faster than this skill:
  [docs.typesafe.ai](https://docs.typesafe.ai) (append `.md` to any page path for raw Markdown;
  index at [docs.typesafe.ai/llms.txt](https://docs.typesafe.ai/llms.txt)). Some structure in this
  skill (the doc-index walking convention, the task table under "find the useful shape") was informed
  by TypeSafe's own MIT-licensed agent skill,
  [github.com/typesafe-ai/skills](https://github.com/typesafe-ai/skills) — read live docs over this
  file when the two disagree; TypeSafe ships new model versions and jaggedness notes faster than a
  bundled plugin can track them.
