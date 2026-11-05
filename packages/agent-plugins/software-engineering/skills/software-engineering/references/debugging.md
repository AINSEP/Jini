# Debugging

Start with observed behavior, expected behavior and a minimal reproducible case. Read the error and relevant logs without exposing secrets or private data. Trace the concrete input through the owning module and its effect boundary; do not patch a downstream symptom while leaving the upstream error intact.

For a bug fix, first write and run a failing regression test that asserts the broken observable behavior. Confirm it fails for the intended reason, not a missing import or broken setup. If a required reproduction capability is absent, name it as UNVERIFIED and state what remains unproven; never fabricate a red or green run.

Form one hypothesis supported by evidence. Probe the dependency in isolation when it could be setup, authentication or tooling. Change one variable at a time. For an external tool's unexplained failure, inspect its current documentation or issue tracker using permitted tools before guessing flags or replacing it.

Do not rerun a byte-identical failed invocation hoping for a different result, except a clearly transient rate-limit or capacity signal. If the same failure occurs twice without progress, stop that loop and report the evidence, current hypothesis and missing capability. Continue independent authorized work.

Implement the smallest correction at the owning boundary. Keep validation, recovery, permissions and supported formats intact. Run the regression and only affected existing checks, inspect the diff, and report before/after evidence. New tests also trigger the scoped mutation procedure in [verification](verification.md). Do not conceal an unresolved failure with a skip, weaker assertion, exclusion or fallback that silently changes behavior.
