# Defaults Checklist

These are the implementation defaults this skill expects after `coding-foundations` is already in scope.

## Defaults

1. **Scaling sanity first**
   Check caller-controlled collections, nested loops, batch transforms, and per-item I/O before coding.

2. **Selective complexity notes**
   Add complexity or query-shape comments only when the tradeoff is materially non-obvious.

3. **Query shape matters**
   For data-heavy code, make bulk vs per-item I/O obvious to the next reader.

4. **No unclear boolean flag parameters**
   Prefer options objects, enums, or named variants over calls like `doThing(data, true, false)`.

5. **Single source of truth**
   Keep rules, mappings, and policy decisions in one owned place.

6. **Descriptive over clever**
   Prefer names and flow that the next reader can understand without decoding tricks.

7. **Document non-obvious tradeoffs**
   If a hot path, framework constraint, or batching choice drove the shape, note that reason near the code.

## Review Signals

Treat these as useful review prompts, not as automatic blockers in every case:

- a loop that hides per-item I/O
- a collection transform that hides query or network fan-out
- duplicated mappings or policy tables
- boolean flags that make call sites ambiguous
- clever compactness that obscures intent
- a non-obvious performance tradeoff with no local explanation
