# jev-1.13 jaggedness — known limitations

Source: `docs.typesafe.ai/model-jaggedness/jev-1.13.md`, TypeSafe's own dated list ("Last reviewed
2026-09-17" at crawl time, 2026-09-21) of known failure modes for the current model version, each
with a stated mitigation. TypeSafe expects some of these to be fixed in later versions — check the
live page before assuming a mitigation is still required for whichever `jev-*` version you're
actually calling.

This is the single most load-bearing reference for "will this question actually work well" — read
it before designing a new question, not after it misbehaves in production.

## 1. Literal reading

Jev "answers the question you wrote, not the one you meant." Scoping words, negations, and implied
conditions are read at face value, not interpreted the way a person reading between the lines would.

**Do instead:** state the exact condition you mean; be specific rather than relying on implication;
put boundary cases directly into `criteria`; if a question unavoidably needs interpretation, split it
into two literal sub-questions and combine the results in code rather than trusting one question to
carry the nuance.

## 2. Math and numbers

**"Jev is not a calculator. We strongly recommend implementing any mathematical logic in code."**

- **Counting** does not work reliably — characters in a word, occurrences of a term, items in a long
  list. Error grows with the size of the thing being counted. **Do instead:** count in code. For a
  *filtered* count (count items matching some semantic condition), ask one Noul per candidate item
  and sum the true/false results in code, rather than asking Jev to count directly.
- **Numeric representations** (hex, RGB, binary, low-level/assembly forms) perform worse than
  semantic or high-level representations of the same information — Jev "cannot reliably judge
  whether two [RGB/hex] values are near each other." **Do instead:** convert to semantic form or
  named buckets in code before asking.
- **Using `score` for exact magnitude:** don't use a Score answer's probability-weighted `score` (or
  the underlying `probabilities`) to compute the *exact* numeric value between two levels of a
  criterion — score can be thresholded or compared, but treating `1.43` as a precise interpolated
  measurement is not supported.

## 3. Date and time comparison

Jev "reads dates as text, not as ordered quantities." Ordering, distance, and window-membership
judgments over dates are unreliable, and get worse with mixed formats, relative references ("next
Thursday"), and domain-specific boundaries.

**Do instead:** extract date *components* as a bounded Choice (e.g. one of 12 months, one of 31
days, a bounded year range) — including an explicit "not stated" option for text that doesn't
actually name a date — then do all ordering, duration, and offset/weekday arithmetic in code. See
`references/cookbooks.md`'s "Date extraction" entry for a full worked example, including a case where
this approach correctly flagged a date the source text never actually stated, instead of the model
inventing one.

## 4. Indirection

"Instructions carrying double negatives or complex indirection are answered less reliably. A
question about a property of a property, or something that requires multiple hops of reasoning,
costs accuracy."

**Do instead:** write instructions directly; name the relevant part of `state` explicitly rather
than making the model infer which part you mean.

## 5. Large state full of irrelevant detail

"Accuracy falls as the state grows with content unrelated to the decision." Jev has a bounded
context window (see `primitives-reference.md`'s Models table for the exact 64k/32k token limits) —
but the accuracy cost of irrelevant content in `state` is a separate, independent problem from the
token limit itself.

**Do instead:** filter in code first and send only the fields a given question actually needs. When
code-side filtering isn't feasible (e.g. you don't know in advance which chunk of a document is
relevant), use a Noul question as a relevance pre-filter before the real question — see
`references/cookbooks.md`'s "Classifying RAG passages" entry.

**Note on an apparent tension:** the introduction docs say that batching *more questions* into one
request "does not create context-rot" — that claim is true and is about parallel, independent
question evaluation. This jaggedness item is a different claim: irrelevant material *in the shared
`state`* does cost accuracy. Both are true at once; don't conflate "add more questions" (safe) with
"pad the state with content the question doesn't need" (costly).

## 6. Adversarial content

"State is data, and jev-1.13 does not treat it as hostile by default." Content written to
adversarially steer the model (prompt injection embedded in retrieved or user-supplied text) can
move the answer. TypeSafe states it expects to improve this in future versions.

**Do instead:** be explicit in `criteria` about what would and wouldn't count; test thoroughly with
adversarial inputs before deploying a question over untrusted content to many users. See
`references/cookbooks.md`'s "Classifying RAG passages" entry for a worked example that specifically
screens for and drops a planted prompt-injection passage using a dedicated Noul question.

## 7. Contradictory instructions and criteria

A mismatch between `instructions` and `criteria` (e.g., a Noul where the `criteria.true` description
actually describes what most people would call "no") degrades performance.

**Do instead:** treat `criteria` as an extension of the instruction, not a separate spec — keep both
aligned in clear, plain language, and re-read a structured question as a whole rather than writing
`instructions` and `criteria` independently.

## 8. No guaranteed structural invariants

Jev is "extremely consistent [for] semantically similar inputs" but does **not** guarantee the kind
of structural invariants a person might assume hold:

- The same underlying question asked as a Noul vs. an equivalent yes/no Choice can disagree
  materially — a documented example gives `noul: 0.22` for one framing and `{choice: "no",
  probabilities: {yes: 0.01, no: 0.99}, confidence: 0.97}` for the logically equivalent Choice
  framing of the same input. Neither is simply derivable from the other.
- A Noul and its logical negation are not guaranteed to sum to 1 — a documented example has
  `refund: 0.72` and `not_refund: 0.47` for the same message (sum 1.19, not 1.0). There are several reasons `P(noul)` and `1 - P(not noul)` may diverge; don't rely on the
  identity holding.

**Do instead:** don't rely on structural/arithmetic invariance between separate questions. Don't
carry a confidence threshold tuned on one question (or question type) over to a different one without
separately validating it.

## 9. Generation

"[Jev is] not trained to generate text. While you can force it to by chaining choices, this will not
work well and will be very slow."

**Do instead:** when the answer space is genuinely bounded, use Choice over the explicit option set
rather than trying to make Jev produce the value as free text. When free text generation is actually
required, use a generative model for that part of the workflow — Jev is not a substitute for one.

## Closing checklist (from the docs' own "avoid" callout)

Avoid:

- Asking Jev something code can compute exactly (counting, dates, arithmetic).
- Hiding several separate judgments inside one question — decompose instead.
- "System Two" tasks — anything needing several layers of indirect reasoning.
- Giving a question more `state` context than it actually needs — "Jev suffers from context rot,"
  specifically with respect to unrelated material in the shared state (see item 5 above).

Community feedback channel TypeSafe links from this page: Discord, `discord.com/invite/WUujKYBp8s`.
