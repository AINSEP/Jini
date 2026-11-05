---
name: secure-input-handling
version: 1.0.0
last_updated: 2026-06-03
description: Use when implementing or reviewing input validation, sanitization, and context-aware output encoding at system boundaries. Framework-agnostic patterns for preventing injection, traversal, and encoding attacks.
---

# Skill: Secure Input Handling

Use this when writing or reviewing code that accepts untrusted input. This skill
provides implementation patterns — the HOW — complementing Security Review's
checklist of WHAT to verify. Every pattern prevents a specific attack class.

Security Review audits code for these patterns. This skill helps write the code
that passes that audit.

## When to Use

- Implementing API endpoints, form handlers, file uploads, or webhook receivers
- Processing input from external systems, queues, partner APIs, or model outputs
- Building search, filter, or user-generated content features
- During Security Review when a validation gap is identified and needs a fix pattern
- Writing test cases for input boundary behavior (TDD Agent)

## When Not to Use

- Reviewing existing code for vulnerabilities at a strategic level (use security-review)
- Choosing authentication/authorization strategy (use security-review)
- Validating business logic constraints (that is domain logic, not sanitization)
- Rate limiting, CSRF protection, or abuse prevention (adjacent concerns, separate skills)

## Rules

1. Treat all external input as untrusted — including from authenticated users, internal services, partner systems, headers, cookies, queues, files, and environment-provided runtime configuration.
2. Validate at trust boundaries before input reaches business logic.
3. Canonicalize before validation when alternate encodings may change meaning (Unicode normalization, URL decoding, path resolution).
4. Prefer allowlists over denylists. Define accepted types, formats, lengths, ranges, enum values, and object shapes.
5. Reject unknown fields where practical, especially for APIs and admin operations.
6. Convert accepted input into typed internal values. Do not pass raw request strings deeper into the system.
7. Use parameterized APIs and structured builders instead of string concatenation for all sinks.
8. Encode output for the exact context where it is used — not upon input, but immediately before the sink.
9. Do not rely on client-side validation for security.
10. Reject or quarantine malformed input. Silent sanitization that rewrites data creates subtle bugs — prefer explicit rejection with informative error messages that do not leak internals.
11. Tests must cover malicious, malformed, oversized, encoded, and unexpected Unicode input.

## Sink Patterns

Apply the correct safe API or encoding immediately before data reaches each sink:

| Sink | Required Pattern |
|------|-----------------|
| SQL / NoSQL query | Parameterized queries or ORM binding. Never build query fragments from input via string concatenation. |
| HTML body | HTML entity encoding (`<` → `&lt;`). Use framework auto-escape; audit every opt-out (`dangerouslySetInnerHTML`, `\|safe`, `<%- %>`). |
| HTML attribute | Attribute-safe encoding with quote wrapping. Avoid dynamic event-handler attributes from input. |
| JavaScript / JSON in HTML | Serialize with trusted JSON encoder. Never inject raw input into `<script>` text or inline handlers. |
| URL / query string | Parse and rebuild with URL APIs. Percent-encode values. Allowlist schemes and hosts for redirects. |
| Shell command | Avoid shell execution entirely. Use argv/argument array APIs (`execFile`, `subprocess.run([...])`). If unavoidable, strict character allowlist `[a-zA-Z0-9._-]`. |
| File path | Resolve canonical path, verify containment within allowed base directory. Reject `..`, absolute paths, null bytes, and control characters. |
| File upload | Validate size, extension, detected content type (MIME sniffing), storage location. Generate server-side filename. Apply malware scan policy. |
| SSRF / network fetch | Allowlist destination schemes and hosts. Block private/loopback/link-local/metadata ranges: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`, `169.254.169.254`. Validate on each redirect hop. |
| Logs | Structured logging (JSON fields). Strip or escape CR/LF and control characters to prevent log injection. Never log secrets, credentials, tokens, or unnecessary PII. |
| XML | Disable external entity processing (XXE) unless explicitly required and sandboxed. Validate against schema. |
| Search / filter syntax | Parse input to AST via builder API. Allowlist fields and operators. Limit depth, result size, and complexity. |
| Mass assignment | Bind only explicitly declared fields. Reject or ignore unknown fields. Never blind-bind request body to database model. |
| HTTP response headers | Strip CR/LF from any value placed in headers (redirect URLs, cookies, Content-Disposition filenames). |
| CSS | Avoid dynamic CSS from user input. If unavoidable, strict token allowlist — no `url()`, `expression()`, or `@import` from input. |
| Email / messaging | Validate recipient format. Prevent header injection via newline stripping. Sanitize display names. |
| Deserialization | Never deserialize untrusted input with unsafe formats (Python pickle, Java ObjectInputStream, PHP unserialize, Ruby Marshal, YAML unsafe_load). Use JSON or schema-validated formats. If unsafe formats are required, sandbox and validate class allowlists. |
| GraphQL | Enforce query depth limits, complexity scoring, and field/alias count caps. Disable introspection in production. Treat batch queries as multiplied attack surface. |
| Template engines | Never pass raw user input as template source. Use sandboxed templates with no access to runtime objects. Audit template string interpolation for SSTI. |
| Regular expressions | Avoid unbounded backtracking (ReDoS). Use linear-time regex engines (RE2, rust regex) for user-supplied patterns. Set execution timeouts on regex evaluation. Do not allow user-supplied regex without sandboxing. |
| Archive extraction | Enforce decompressed size limits, file count limits, and path validation before extraction. Reject zip bombs, tar symlink attacks, and path traversal within archives. |
| LLM / model output | Treat model-generated text as untrusted when used in downstream sinks (SQL, HTML, shell, file paths). Apply the same sink protections as for user input. |

## Workflow

### 1. Identify Trust Boundaries

List every input source and mark who controls it. Include: HTTP request bodies, query params, path params, headers, cookies, file uploads, webhook payloads, queue messages, partner API responses, MCP and tool results, plugin manifests, model outputs, import files, CLI arguments.

### 2. Define Input Contract

For each boundary, specify: required fields, optional fields, types, ranges, lengths, formats, enum values, nested object rules, and unknown-field behavior.

### 3. Canonicalize

Apply normalization needed for the domain: Unicode NFC normalization, URL parsing, path resolution, case normalization for identifiers, trimming where appropriate.

### 4. Validate

Reject values that do not match the contract. Use schema validators and typed request models:
- TypeScript: zod, valibot, joi
- Python: pydantic, marshmallow
- Go: go-playground/validator
- Java/Kotlin: Jakarta Bean Validation
- Ruby: dry-validation

Prefer strict schemas that reject unknown fields for external-facing APIs.

### 5. Transform

Convert accepted values into typed internal structures. Raw input should not propagate past this point.

### 6. Protect Every Sink

Apply the sink-specific pattern from the table above. This happens at output time, not input time.

### 7. Add Tests

Tests must cover:
- Valid input (golden path)
- Missing required fields
- Unknown / extra fields
- Boundary lengths (min, max, max+1)
- Invalid types and out-of-range values
- Encoded traversal (`%2e%2e`, double-encoding)
- Repeated decoding attempts
- SQL, XSS, shell, and template injection strings
- CR/LF header and log injection
- Unexpected Unicode normalization (homoglyphs, RTL override)
- Oversized payloads
- Redirects to unapproved hosts
- Uploads with mismatched extension and content type
- SSRF attempts (private IPs, metadata endpoints)
- Mass assignment attempts (extra fields like `role`, `is_admin`)
- GraphQL depth/complexity bombs
- Archive decompression bombs (zip bombs, excessive file count)
- Deserialization payloads (if unsafe formats are accepted)
- ReDoS patterns (catastrophic backtracking strings)
- Template injection strings (`{{`, `${`, `<%`)

### 8. Review Failure Behavior

Confirm: invalid input fails closed, error responses are consistent, errors do not leak stack traces or internal state, and logs contain enough diagnostic detail without exposing sensitive data.

## Usage Context

This skill is reusable across any pipeline, agent, or team — it is not coupled to a specific agent framework. Typical usage:

- **During implementation:** Apply these patterns when writing code that handles external input.
- **During testing:** Use the test checklist to design boundary and adversarial test cases.
- **During security review:** Verify that code follows these sink-specific patterns.
- **During spec/design:** Reference sink patterns to define input constraints and validation expectations.

### Inputs

- API contracts, UI flows, data model, or any definition of where external input enters the system
- Security findings (if applying patterns to fix an identified vulnerability)

### Outputs

- Validated trust boundaries with schema definitions
- Sink-specific protections applied at each dangerous output point
- Test cases covering malicious, malformed, and boundary inputs
- Residual risks documented

### Risks if skipped

Unvalidated boundary, wrong output encoding, string-built sink, unknown-field binding, framework protection assumption, deserialization of untrusted format, ReDoS in validation regex

## References

- Related skills: security-review, test-design, api-contracts
- Relationship to Security Review: This skill is prescriptive (how to write safe code). Security Review is diagnostic (does the code have vulnerabilities). They reference each other.
