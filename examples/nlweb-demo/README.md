# nlweb-demo

A small NLWeb-shaped spike: ask a site a question in natural language, get Schema.org back.

**This is a spike, not architecture.** Nothing here is `@jini/*` yet, and nothing depends on it.
Its purpose is to answer one question cheaply — *does retrieval quality actually require
embeddings for a site this size?* — before anyone builds an embedding pipeline.

```bash
pnpm --dir examples/nlweb-demo start
curl -s --get --data-urlencode 'q=how often should I water the window plants' \
  http://127.0.0.1:4319/ask | python3 -m json.tool
```

## What it does

`POST /ask {"question": "..."}` or `GET /ask?q=...` → a Schema.org `SearchResultsPage`.

Retrieval is **keyword scoring, no embeddings, no vector store, no API key**: rarity-weighted
term matching across title, keywords, description and body, with title hits worth six times a
body hit. Roughly 90 lines. An optional summarizer is injected and absent by default, so the
whole thing runs offline.

## What the spike actually found

Measured against the five sample items, not asserted:

| Question | Top result | Verdict |
|---|---|---|
| "how often should I water the window plants" | the watering FAQ, score 39.1 — next best 9.7 | correct, decisively |
| "brass watering can with a long spout" | the Product | correct |
| "why does waiting make coffee taste better" | the coffee article, score 18.8 | correct, and note *none* of "why/does/taste" is a title word |
| "quarterly revenue forecast" | nothing, `noMatch: true` | correct — refuses rather than guessing |
| **"what can I buy to help with my houseplants"** | **nothing, `noMatch: true`** | **wrong — the watering can is the answer** |

That last row is the whole result. Keyword retrieval handles paraphrase fine as long as *some*
content word overlaps ("waiting", "coffee"). It fails completely when the user's word and the
site's word are synonyms — "houseplants" never matches "plants", so a perfectly good product
result is invisible.

**So the decision rule is concrete rather than a matter of taste:** if the queries you expect
share vocabulary with your content, keyword is enough and costs nothing to run. If users will
say "houseplants" when you wrote "plants", you need embeddings — and that failure is cheap to
detect, because it shows up as `noMatch` on questions that obviously have an answer.

A useful middle option before committing to a vector store: keep keyword retrieval and add a
synonym map for the handful of terms your domain actually cares about.

## What would move into the engine, and what would not

The split this argues for is the same one `PageDriver` uses.

**Generic — could live in `@jini/*`:** the `/ask` endpoint, retrieval and ranking, the
Schema.org response shaping, the `noMatch` contract, and the MCP projection (every NLWeb
endpoint is also an MCP server, and Jini already has an MCP server).

**Product-owned — never in the engine:** `items.ts`. Only Tovu knows what a Tovu article is.
The engine sees `SchemaOrgItem` and nothing more. Schema.org is generic web vocabulary rather
than product vocabulary, which is what makes it admissible as the shared shape at all.

**Missing from Jini entirely:** embeddings and vector search. There is no such primitive in the
repo today — that is the one real subsystem an embeddings-based version would need. The LLM half
already exists: `@jini/memory`'s `llm-provider` is a multi-vendor "call an LLM, get strict JSON
back" call, which is exactly the shape the summarizer wants.

## Files

| File | Role |
|---|---|
| `src/items.ts` | The corpus. **The part a real product owns.** |
| `src/retrieve.ts` | Tokenizing and rarity-weighted scoring. |
| `src/ask.ts` | Response shaping, `noMatch`, optional summarizer. |
| `src/server.ts` | ~60 lines of `node:http`. No framework, on purpose. |

## Notes on the details that matter

- **`noMatch` is a first-class field.** An empty result list presented as an answer is worse
  than saying "I have nothing on that". The tests pin this.
- **The summarizer only ever sees what retrieval returned**, never the whole corpus. Feeding it
  everything would make answers independent of retrieval quality and hide the very thing being
  measured.
- **Ties break deterministically**, so results do not flicker between identical calls.
- **`text` is never returned** — it is index fodder, not part of the answer.
