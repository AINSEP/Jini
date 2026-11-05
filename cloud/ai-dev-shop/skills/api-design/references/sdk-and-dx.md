# SDK And Consumer Ergonomics

## Use When

- consumers will integrate through generated clients or hand-written SDKs
- the API is intended for broad internal adoption, partner onboarding, or third-party developer use
- client ergonomics will meaningfully affect support burden

## Rules

- Keep naming stable and predictable across methods, resources, and fields.
- Make auth setup obvious. A consumer should not need multiple overlapping auth paths for the same surface.
- Expose pagination helpers or clear cursor handling patterns.
- Classify retryable versus non-retryable failures in a machine-readable way.
- Keep enums, unions, and error codes stable enough for typed consumers.
- Do not leak transport trivia into every call site if the SDK can centralize it cleanly.
- Generated clients are not a substitute for examples. Provide at least one happy-path flow and one failure-path flow.

## Review Questions

- Would a generated client from this contract feel coherent?
- Are timeouts, retries, and auth obvious to consumers?
- Are error codes and field names consistent enough for code completion and telemetry?
- Does the client API mirror the domain, or just the transport?

## References

- OpenAPI Specification: https://spec.openapis.org/oas/latest.html
