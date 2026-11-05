---
name: security-review
version: 1.0.0
last_updated: 2026-02-22
description: Use when analyzing security threat surface, classifying finding severity, reviewing authentication, input validation, secret handling, or business logic flaws.
---

# Skill: Security Review

Security review in this system is not a checklist pass at the end of the pipeline. It is a reasoning process: trace what the attacker controls, follow the data, find where trust assumptions break. Rule-based static analysis catches known patterns. This skill is for catching the things static analysis misses — broken access control, business logic flaws, and complex data flow vulnerabilities.

Nothing gets patched without human approval. The Security Agent surfaces findings and provides mitigations. A human decides what ships.

## Threat Surface Analysis

Before reviewing specific code, map the attack surface:

**Entry points** — Where does untrusted data enter the system?
- HTTP endpoints (path params, query params, request body, headers, cookies)
- File uploads
- Webhook receivers
- CLI arguments
- Environment variable injection

**Trust boundaries** — Where does the system change trust level?
- Unauthenticated → authenticated
- User → admin
- External → internal service
- Public API → internal API

**Sensitive data flows** — Where does sensitive data travel?
- PII (names, emails, addresses)
- Credentials (passwords, API keys, tokens)
- Financial data (card numbers, account numbers)
- Health data

**External integrations** — What third-party systems are called, and with what data?

Document the trust boundary map before reviewing any individual finding. Many vulnerabilities only become visible when you trace across multiple components.

## Review Dimensions

### Authentication and Authorization

- Is every endpoint that requires authentication actually protected?
- Is authorization checked at the right level (resource-level, not just route-level)?
- Can a user access another user's data by changing an ID parameter (IDOR)?
- Are JWT tokens validated (signature, expiry, audience, issuer)?
- Are session tokens invalidated on logout?
- Is privilege escalation possible (regular user → admin)?

### Input Validation

- Is all user input validated before use?
- Is validation at the system boundary (API layer), not buried in service code?
- Are SQL queries parameterized or using an ORM that prevents injection?
- Is HTML output properly escaped to prevent XSS?
- Are file upload types, sizes, and names validated?
- Is path traversal prevented for any file system operations?

### Secret Handling

- Are secrets stored in environment variables or a secrets manager, never in code?
- Are API keys, passwords, and tokens excluded from logs?
- Are secrets excluded from error messages and stack traces?
- Is `.env` in `.gitignore`?
- Are database connection strings and private keys absent from the codebase?

### Business Logic Flaws

These are invisible to static analysis. Trace the business rules:
- Can a resource be purchased for a negative price?
- Can a paid status be set without a payment being processed?
- Can a rate limit be bypassed by creating multiple accounts?
- Can a workflow step be skipped by calling a later endpoint directly?
- Can a discount code be applied multiple times?

### Dependency Security

- Are dependencies pinned to specific versions?
- Are there known CVEs in current dependencies? (Flag for review, not auto-patch)
- Are build dependencies separated from runtime dependencies?

## Severity Classification

Every finding must be classified before reporting. This determines what blocks a release.

**Critical**: Immediate, exploitable, high impact. Blocks release. Requires human approval before any patch ships.
- Authentication bypass
- Remote code execution
- Mass data exfiltration (PII/financial data)
- Privilege escalation to admin

**High**: Exploitable with moderate effort, significant impact. Blocks release. Requires human review.
- IDOR giving access to other users' data
- SQL injection
- Stored XSS
- Secrets in source code

**Medium**: Exploitable in specific conditions, limited impact. Does not block release but must be tracked.
- Missing rate limiting on sensitive endpoints
- Reflected XSS
- Verbose error messages leaking stack traces
- Weak session tokens

**Low**: Defense in depth, unlikely to be exploited alone. Track and address in next cycle.
- Missing security headers (Content-Security-Policy, X-Frame-Options)
- Overly permissive CORS
- Insecure cookie flags on non-sensitive cookies

## Finding Report Format

Every finding must include all of these:

```
ID:          SEC-001
Severity:    High
Component:   GET /invoices/:id
Type:        Insecure Direct Object Reference (IDOR)

Description:
The invoice endpoint returns the full invoice object for any authenticated user
who provides a valid invoice ID, regardless of whether they own that invoice.
An attacker can enumerate invoice IDs and read other users' invoices.

Exploit Scenario:
1. Attacker authenticates as user A
2. Attacker sends GET /invoices/1234 where invoice 1234 belongs to user B
3. Server returns full invoice including customer PII and financial data

Affected Files:
- src/routes/invoices.ts:47
- src/services/invoice-service.ts:23

Mitigation:
Add ownership check before returning invoice:
  if (invoice.userId !== req.user.id) return 403

Verification Steps:
1. Authenticate as user A
2. Obtain an invoice ID belonging to user B (via another test account)
3. Confirm GET /invoices/<user-b-invoice-id> returns 403
4. Confirm user A can still access their own invoices

Human Sign-Off Required: Yes
```

## What Security Review Is Not

- It is not re-running the same static analysis tools the CI pipeline already runs
- It is not adding security headers without understanding the threat they mitigate
- It is not a one-time review — any code change to auth, data access, or external integrations requires a new review of the affected paths
- It is not auto-patching — every fix requires human approval before it ships

## Interaction with Other Agents

**Receives from**: Code Inspection (flags components for security review), Coordinator (dispatches after implementation)

**Reports to**: Coordinator with severity-classified findings

**Coordinator routes**: High/Critical findings → Programmer Agent with exact mitigation steps, then back to Security for verification

**Human sign-off required**: Any Critical finding. Any High finding that affects authentication, authorization, or data exfiltration.

The Security Agent never commits code directly. It produces a findings report. The Programmer implements the fix. The Security Agent verifies.

## References

When reviewing code that interacts with LLMs, handles external npm dependencies, or exposes server-side URL fetch endpoints, load `references/llm-owasp-and-advanced.md` before proceeding.
