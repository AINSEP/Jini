# Cookbook digests

Short digests of all 18 cookbooks TypeSafe publishes at `docs.typesafe.ai/cookbooks/*` (crawled
2026-09-21). Every cookbook's own code uses the Python SDK (`client.system_one(...)`,
`Choice`/`Score`/`Noul` classes) — the call shape differs cosmetically from the JavaScript SDK's
`client.systemOne(...)` / lowercase `choice(...)` helper (see `javascript-sdk.md`), but the
primitives, request/response shapes, and lessons are identical across languages. Read the full page
for a shape close to what you're building — these are worth more than a first-pass design from
scratch.

## Self-consistency: nouls

`cookbooks/consistency_noul_cookbook.md` — Runs a 14-question Noul rubric over one insurance claim,
15 times each, across non-reasoning LLMs, reasoning LLMs, and Jev. Jev's mean per-question
probability std dev (0.0102) beats every LLM condition; a 14-question Jev call runs ~111ms /
$0.000043, vs. the cheapest LLM condition at 1113ms / $0.000950 (10x slower, 22x costlier) up to a
reasoning-model condition at 13886ms / $0.034275 (125x slower, 805x costlier). **Lesson:** repeated
calls still wobble even for Jev — pair a raw probability with an "uncertain band" (e.g. 0.30–0.70)
that routes borderline cases to human review, rather than trusting one call's label outright.

## Self-consistency: choices

`cookbooks/consistency_choice_cookbook.md` — Same test, an 8-question moderation Choice rubric, 15
repeats. Jev's plurality-label agreement (90.8%) is lower than some LLM conditions (87.5–100%) on
raw repeats, but gating on `confidence ≥ 0.6` raises Jev's agreement to 99.2% with 74.2%
auto-labeled. Cost/speed: ~114ms / $0.000046 per call vs. 826ms–12978ms / $0.000936–$0.041255 for LLM
conditions. **Lesson:** confidence-gating turns Jev's imperfect self-consistency into a reliable
automated majority, at a fraction of LLM cost/latency.

## Parallel questions

`cookbooks/parallel_questions.md` — Batches a 13-question regulatory briefing (8 Noul + 2 Choice + 3
Score) over the ~54k-character GDPR Wikipedia article, one request vs. 13 separate requests, 5
repeats. Batching: **12.2x cheaper, 10.0x faster** ($0.000497/0.27s vs. $0.006090/2.71s), with
near-identical answers across repeats regardless of batching. **Lesson:** batching multiple
independent questions about the same state collapses the document-resend cost — the larger the
shared state relative to the questions, the closer the saving is to a full Nx.

## Re-ranking

`cookbooks/rerank_typesafe.md` — Two-stage legal search: BM25 builds a 30-candidate shortlist per
query (3,565 CLERC passages, 40 queries), then one Jev Noul question per (query, candidate) pair
re-ranks by the returned probability. Top-1 accuracy 5%→18%, top-5 15%→35%, top-10 38%→62%.
**Lesson:** cheap retrieval is good at shortlisting, bad at picking the single best match; a per-pair
Noul re-ranker meaningfully improves precision at the top of the list. The cookbook asks one
question per pair for clarity. It says a real application would ask several questions about the
same pair in one call.

## Line-by-line search

`cookbooks/semantic_find.md` — Tags every line of GitHub's ToS with an id, then one request asks a
Choice question ranking all 218 line ids by relevance plus a Noul checking whether the document
actually contains an answer at all. A ranking-only approach can look confident (top-ranked line at
0.86 relevance) even when the real answer isn't in the document (`exists` probability only 0.14).
**Lesson:** pair a ranking Choice with a separate existence-check Noul so you can distinguish "found
it," "not in the document," and "partially answered," instead of returning the top rank uncritically.

## Structure recovery

`cookbooks/autoformat.md` — Reconstructs lost Markdown structure from hard-wrapped plain text in two
sequential requests: Pass 1 asks one Noul per adjacent line pair ("did this break split a
sentence?"); Pass 2 asks one Choice per merged block (heading/list/code/callout/paragraph) plus
companion questions read only when relevant. The model never generates text — every output character
still traces to the input. Example: 2 round trips, 10,211 tokens, 0.8s, $0.0015. **Lesson:** keep
anything code can already determine (blank lines, explicit markers) out of the model call entirely —
send only the judgment calls code genuinely can't make, and let code do all the rendering.

## Function calling

`cookbooks/function_calling.md` — Maps natural-language trading requests to ten typed Python
functions: each closed-set/`Literal` argument becomes a Choice question, one request answers every
argument for the call, and a confidence-aware `Dispatcher` returns the function name plus arguments.
Example: `rolling_correlation(symbol='AMD', benchmark='NVDA')` at confidence 0.82 overall, with
per-argument probabilities (0.87, 0.78) and omitted arguments falling back to function defaults
(p=0.96/0.99). **Lesson:** a compound call's confidence should be the *minimum* across its parts
(the weakest judgment), not a product — a product understates confidence as argument count grows.
An explicit "was this stated?" question lets an argument fall back to its default instead of being
forced into a confident-sounding guess.

## Skill suggestion

`cookbooks/skill_suggestion.md` — Picks at most one skill per agent turn from a 182-skill roster in
two sequential requests: request 1 ranks all 182 skills cheaply and decides whether the turn needs
one at all; request 2 re-reads only the top 3 in full and can reject all of them. Across 488 turns:
agent alone with the roster — 16.8% wrong-skill loads, 9.8% loads-when-nothing-fits; agent +
suggestion — 7.3% / 4.0% (more than half reduction); agent handed the right answer directly — 2.5% /
1.2% (the floor isn't zero even with a perfect hint). **Lesson:** for large rosters, don't truncate
descriptions into the prompt — cheap rank-all-candidates, then read-and-verify only the top few, with
the ability to reject all of them.

## Knowledge graph entity alignment

`cookbooks/entity_alignment.md` — Decides which of 450 candidate pairs across two beer-catalogue
sources describe the same product, using one Score question with exactly 3 ordered levels (different
/ related-but-maybe-not-same / same → merge), plus 3 riding Noul questions telling a curator which
field two records disagree on. Of 450 pairs: 40 (8.9%) auto-merged, 50 (11.1%) queued for a curator,
360 (80.0%) left unlinked. **Lesson:** use Score (not a Noul threshold or Choice) when outcome levels
are genuinely ordered and each needs its own criteria — it avoids inventing an arbitrary probability
cutoff, since the levels map directly onto the outcomes.

## Classifying RAG passages

`cookbooks/classifying_rag_passages.md` — Inserts a classification stage between retrieval and
generation: for each retrieved passage, one request carries 4 Noul questions (relevant? states
usable evidence? contradicts the query's premise? tries to instruct the model?), and ordinary
threshold code decides accept / flag-conflict / drop. Catches a planted prompt-injection passage and
flags queries with false premises against real evidence. **Lesson:** keep the accept/flag/drop policy
as explicit code-level thresholds over structured probabilities. The jaggedness page links this
cookbook as the worked example for #5 (irrelevant state). It also shows one way to screen out
prompt injection (#6), though the jaggedness page doesn't cite it for that.

## Double-checking citations

`cookbooks/citation_check.md` — Verifies an LLM's cited quotes: a plain string match first checks
whether the quote exists verbatim in the source (free, catches fabrication outright), then a Choice
question classifies how the quote's context relates to the claim (supports / contradicts /
says-nothing), gated at `confidence ≥ 0.8` before accepting the verdict without human review.
8 citations tested: 4 accurate ones verified at confidence ≥0.93; all 4 planted failures caught.
**Lesson:** don't send every check to the model — a free code-level pre-filter (string match) should
catch what it can before spending a model call on the judgment it actually requires.

## Guardrails for LLMs

`cookbooks/llm_guardrails.md` — Screens inbound and outbound LLM messages with one request per
message: a battery of Noul questions gives P(hazard) per named hazard (jailbreak, policy-breaking
reply, harm/crime, medical dosage, self-harm), plus one Score question rating how much harm
complying would do; app code thresholds the results into pass/review/block/route. **Lesson:** put
safety policy in externally-readable, editable code-level thresholds over structured probabilities,
not buried in a system prompt or a second general-purpose "judge" LLM call — and run the same guard
on both input and output, since a safe-looking prompt can still produce an unsafe reply.

## SDE cascade

`cookbooks/sde_cascade.md` — A 2-stage structured-data-extraction cascade: extract with a cheap
small model in plain-text mode, verify each extracted field with a per-field Jev Noul question
("is this value absent from the source?", framed so `true` = escalate), escalate only flagged items
to an expensive reasoning model. Stage pricing: cheap extractor $0.75/$4.50 per 1M tokens (in/out);
reasoning escalation $5.00/$30.00 (~7x); Jev verifier $0.042/$0.00. The swept-threshold cascade's
Pareto frontier beats every single model tested on quality-per-dollar. **Lesson:** a good verifier
question must be narrow and grounded (one checkable yes/no per field against the source), framed so
the *escalate* case is `true`, and aggregated per-field with `max` (any single flag escalates) rather
than averaged — averaging silences one confident red flag among many quiet fields.

## Date extraction

`cookbooks/date_extraction_cookbook.md` — Extracts absolute and relative dates by asking Choice
questions about which date parts (month/day/year/weekday, date kind) the text actually states, then
resolving those parts to a real date entirely in code. Example: 6 questions across 4 documents — 5
auto-accepted (confidence 0.91–0.97), 1 sent to review at confidence 0.46 (correctly flagged as
incomplete rather than the model inventing a date). Review threshold used: confidence < 0.60.
**Lesson:** let code do all date arithmetic; the model only reads what the text literally names —
this directly implements jaggedness #3's mitigation.

## Pre-parsed value extraction

`cookbooks/pre_parsed_value_extraction_cookbook.md` — A regex finds candidate spans (emails, phone
numbers, dollar amounts); Jev's Choice then picks which candidate answers a specific question, and
code copies that span verbatim and normalizes it — the returned value is always literally one of the
regex's own matches, never invented. Two stated hard limits: Choice allows at most 255 options (past
that, narrow in two stages); and result quality depends on having a good candidate-finder (regex,
NER, or another cheap proposer) — names in particular have no simple regex. **Lesson:** when a value
must come verbatim from the source with zero risk of alteration, never let the model output free
text — have code enumerate exhaustive candidates and let Choice only ever select among them.

## Hierarchical classification

`cookbooks/hierarchical_classification.md` — Classifies documents down deep taxonomies (patents,
product categories, biomedical subjects, a codebase file tree) by walking node-to-node with Choice
questions, comparing greedy search (always take the top child) against beam search (keep top-K
paths, score by length-normalized geometric-mean edge probability, explored via parallel requests).
Beam search (K=3) matched 4/4 expected leaves across 4 hierarchies; greedy matched 2/4 (an early
wrong turn couldn't be recovered). **Lesson:** for deep/branching taxonomies, prefer beam search over
greedy — parallel requests make exploring several candidate paths cheap, and it recovers from an
ambiguous early decision that greedy can't undo. This directly implements the "walking a taxonomy"
technique in `primitives-reference.md`.

## Autoresearch feature discovery

`cookbooks/autoresearch_feature_discovery.md` — An LLM proposes candidate numeric features (as
natural-language questions) for a gradient-boosting model predicting a wine score from tasting notes;
each round, Jev answers all proposed questions for every row (intensity → Score, presence → Noul),
k-fold CV judges whether to keep/revise/drop each question. Over 5 rounds (1,200 dev / 800 held-out
rows), held-out RMSE improved 0.097 points; ended with 38 kept questions. **Lesson:** Jev questions
can serve as an LLM-designed, numerically-scored feature layer in front of an ordinary ML model — the
LLM proposes what to ask, Jev answers it cheaply and consistently at scale, and a held-out set that
the loop never reads is what actually validates whether new questions help.

## Classification using confidence

`cookbooks/classification_using_confidence.md` — Classifies SEC filings into 1 of 75 industry groups
with a single Choice question, then uses that answer's own `confidence` to decide whether to report
the specific group or fall back to its broader parent division. Across 60 filings, a confidence cutoff
of 0.9 splits them roughly in half: the confident half is correct 90% of the time at the specific
level, the unsure half only 40% — but reporting the unsure half at the broader division level raises
it to 70% correct. **Lesson:** a Choice answer's own confidence is a free built-in signal for
"trust the specific label, or hedge" — when labels form a hierarchy, hedging to the parent category is
a nearly-free way to trade specificity for reliability exactly where it's needed.
