# Patterns

TypeSafe documents four named architectural patterns for using Jev in a larger system
(`docs.typesafe.ai/patterns.md` and its four sub-pages, crawled 2026-09-21). Each assumes you
already understand the primitives and confidence — read the main `SKILL.md` first if you haven't.

## Speculative fan-out

**What:** Put every question a system might need — including ones that only matter for some inputs
— into a single request, and let code decide afterward what's relevant. Every question evaluates in
parallel against the same `state`, so adding more of them usually has little effect on response time.

**Worked example (support-ticket triage, one request, 5 questions):**

- `category` (Choice: `bug_report` / `billing` / `feature_request` / `account`)
- `bug_severity` (Score, 3 levels) — only meaningful if `category == bug_report`
- `has_reproducible_steps` (Noul) — only meaningful if `category == bug_report`
- `refund_requested` (Noul) — only meaningful if `category == billing`
- `frustration` (Score, 3 levels) — relevant regardless of category

All five are asked upfront; the ones that don't apply to a given ticket are simply ignored in code.
Routing logic then reads whichever answers matter:

```python
if category.choice == "bug_report":
    if bug_severity.score > 1.5 and bug_repro.noul > 0.6:
        escalate_to_engineering(ticket)  # high severity + reproducible
elif category.choice == "billing":
    if refund.noul > 0.7:
        flag_likely_refund(ticket)
# ...other categories...
if frustration.score > 1.5:
    flag_for_priority_response(ticket)  # regardless of category
```

The category answer decides which speculative answers get read. A bug-report ticket's `refund`
answer is never consulted.

**Why:** cost and speed. A separate request per question would resend the state each time and add
round trips. In one request, the extra questions cost only their own tokens and barely change
latency.

## Confidence-gated routing

**What:** Use `confidence` as a second decision axis alongside the answer itself — the answer says
*what*, confidence says *whether to act on it*. Give different actions different confidence floors
based on the cost of being wrong.

**Worked example (voice banking commands, one Choice question, `intent`: `check_balance` /
`approve_transfer` / `other`):**

```python
if intent.confidence < 0.6:
    route_to_human_agent(request)          # floor: catches anything genuinely uncertain
elif intent.choice == "check_balance":
    # Low stakes — 0.6 is already sufficient.
    show_balance(request)
elif intent.choice == "approve_transfer":
    if intent.confidence > 0.85:
        approve_automatically(request)      # high stakes, but high confidence
    else:
        ask_user_to_confirm(request)        # high stakes, moderate confidence
```

**Why:** the same 0.6 floor filters out genuine model uncertainty regardless of intent; above that,
each action gets its own threshold scaled to how expensive a wrong automatic action would be.
Thresholds like these are domain-specific and not portable between question types — don't carry a
threshold tuned on one Choice over to a different Choice or a Score without re-validating it.

## Composite scoring

**What:** Break one complex judgment into several independent Score dimensions, normalize each to
0–1, and combine them with weights owned in code — rather than asking the model to produce one
holistic number directly.

**Worked example (resume screening, 4 independent 5-level Score questions in one request:
`python_depth`, `team_leadership`, `system_design`, `generalist`), combined with different weights
for two different roles from the same raw scores:**

```python
py, lead, arch, general = (response.answers[k].score / 4 for k in
    ["python_depth", "team_leadership", "system_design", "generalist"])

# Senior IC
ic_score = (0.40 * py) + (0.10 * lead) + (0.40 * arch) + (0.10 * general)

# Engineering Manager
em_score = (0.15 * py) + (0.40 * lead) + (0.20 * arch) + (0.25 * general)
```

**Why:** ranking candidates this way gives visibility into exactly how the final number was built
(each component is inspectable), and the same raw per-dimension scores can be re-weighted for a
different downstream decision without another model call.

## Intent routing

**What:** Use Jev as a cheap, fast classifier in front of the real handlers, so only the requests
that actually need an expensive model or a human get one.

**Worked example (customer-service routing, 2 questions in one request — `intent`: Choice of
`order_status` / `product_question` / `return_exchange` / `complaint`; `complexity`: Score, 3
levels):**

```python
if intent.confidence < 0.5:
    route_to_human(request)                            # floor, applies to every intent
elif intent.choice == "order_status":
    handle_deterministically(request)                    # no LLM at all
elif intent.choice == "product_question":
    route_to_llm("product_specialist", request)
elif intent.choice == "return_exchange":
    route_to_llm("returns_specialist", request)
elif intent.choice == "complaint":
    if complexity.score > 1 or complexity.confidence < 0.5:
        route_to_human(request)
    else:
        route_to_llm("complaint_resolution", request)
```

**Why:** one intent needs no LLM at all, two route to different specialist LLMs, and one uses a
*second* answer's confidence (`complexity`, a Score) to decide between an LLM and a human —
reinforcing that a confidence threshold's meaning depends on which question and which stakes it's
gating, not a single number reused everywhere.
