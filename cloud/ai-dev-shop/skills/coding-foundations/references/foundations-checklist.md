# Foundations Checklist

These are the shared micro-level defaults this repo expects before any child skill adds stricter rules.

## Defaults

1. **Explicit dependencies**
   Inject or pass collaborators into logic-bearing code instead of hiding them behind globals or inline construction.

2. **Decision logic separated from effects**
   Keep rule evaluation distinct from I/O, logging, transactions, and framework orchestration where practical.

3. **Immutable by default**
   Avoid mutating inputs or shared state unless the contract or performance reason is clear.

4. **Explicit stable contracts**
   Prefer named fields, predictable shapes, and stable outputs at module boundaries.

5. **Fail fast on invalid state**
   Reject malformed input and impossible state early unless the spec explicitly requires graceful degradation.

6. **Small readable units**
   Keep helpers, exported surfaces, and local scopes narrow enough that intent stays obvious.

## Review Signals

Treat these as review prompts, not automatic blockers in every case:

- a helper that looks pure but reads globals or ambient config
- inline dependency construction that hides collaborators or side effects
- mutation that leaks across callers with no clear contract
- a boundary function with an ambiguous or unstable return shape
- one unit mixing business rules, formatting, and side effects
