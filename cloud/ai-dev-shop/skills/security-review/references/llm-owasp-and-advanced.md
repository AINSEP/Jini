<!-- Source: Addy Osmani / agent-skills / security-and-hardening -->

# LLM, OWASP, and Advanced Security Reference

## LLM Security Patterns (OWASP LLM Top 10 2025)

The OWASP Top 10 for LLM Applications covers vulnerabilities specific to systems that integrate large language models. These are not caught by traditional static analysis. The patterns below cover the most critical categories — consult https://genai.owasp.org/llm-top-10/ for the full numbered list; category numbers shift between versions.

### Prompt Injection (LLM01 in 2025)

Untrusted content in the prompt hijacks the model's instructions. Direct injection targets the system prompt; indirect injection embeds malicious instructions in retrieved documents, tool output, or user-supplied data.

**Mitigations:**
- Treat all LLM output as untrusted data, not trusted code
- Validate and sanitize LLM output before any downstream action
- Use explicit output schemas (structured JSON) rather than free-form instruction following
- Separate instruction context from data context where possible

### Improper Output Handling (LLM05 in 2025)

LLM output rendered into HTML, executed as code, or passed to shell commands without sanitization.

```javascript
// NEVER — executes arbitrary code from model output
eval(llmOutput);

// NEVER — injects arbitrary HTML/scripts
element.innerHTML = llmOutput;

// CORRECT — treat output as text only
element.textContent = llmOutput;

// CORRECT — if HTML is required, sanitize first
import DOMPurify from 'dompurify';
element.innerHTML = DOMPurify.sanitize(llmOutput);
```

### Excessive Agency (LLM06 in 2025)

The model can take irreversible or high-impact actions autonomously. Common in agent architectures with write access, deletion authority, or external API calls.

**Mitigations:**
- Require human confirmation for destructive or irreversible actions; for third-party tools the host does not control, follow `<AI_DEV_SHOP_ROOT>/skills/tool-design/SKILL.md` (Host-Side Approval for External Tools)
- Scope tool permissions to minimum required — read before write, write before delete
- Log all agent actions with full context for audit
- Implement rate limits and spending caps on LLM-driven automation

### Unbounded Consumption (LLM10 in 2025)

Model calls with no token limits, cost controls, or rate limiting allow resource exhaustion and runaway billing.

**Mitigations:**
- Set `max_tokens` on every model call
- Apply per-user and per-tenant rate limits on LLM endpoints
- Alert on cost anomalies
- Implement request queuing under load

### RAG Data Isolation

When using retrieval-augmented generation, retrieved documents from one tenant must never appear in another tenant's context.

**Mitigations:**
- Filter retrieval by tenant/user scope before embedding search
- Never mix document namespaces in the vector store
- Audit retrieval results before injecting into prompt

---

## STRIDE Threat Modeling for API Boundaries

STRIDE is a structured framework for identifying threats at trust boundaries. Apply it at every API endpoint, message queue, and service-to-service call.

| Threat | Definition | Example | Mitigations |
|--------|-----------|---------|-------------|
| **Spoofing** | Attacker claims to be someone they are not | Forged JWT, replayed token, fake webhook sender | Strong authentication, token expiry, webhook signature verification |
| **Tampering** | Attacker modifies data in transit or at rest | MITM modifying request body, DB row manipulation | TLS everywhere, HMAC signatures, parameterized queries, write authorization checks |
| **Repudiation** | Actor denies taking an action with no way to disprove it | User denies placing order, agent denies triggering delete | Immutable audit logs with timestamps and actor IDs, non-repudiation tokens |
| **Information Disclosure** | Attacker gains access to data they should not see | IDOR exposing another user's records, stack traces in error responses | RBAC at resource level, structured error responses (no stack traces to clients), PII masking in logs |
| **Denial of Service** | Attacker makes the system unavailable | Unbounded query exhausting DB connections, resource exhaustion via large uploads | Rate limiting, input size caps, circuit breakers, request timeouts |
| **Elevation of Privilege** | Attacker gains capabilities beyond their authorization | Regular user accessing admin endpoint, SSRF reaching internal metadata service | Function-level auth on every privileged operation, least-privilege service accounts |

---

## SSRF Prevention

Server-Side Request Forgery allows an attacker to make the server fetch arbitrary URLs, potentially reaching internal services, cloud metadata endpoints, or localhost.

### Implementation Pattern

```javascript
import dns from 'dns/promises';
import ipaddr from 'ipaddr.js';

async function isSafeUrl(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Only allow HTTP/HTTPS
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;

  // Resolve all IP addresses for the hostname
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.lookup(parsed.hostname, { all: true });
  } catch {
    return false;
  }

  // Allow only public unicast addresses.
  // ipaddr.process() normalizes IPv4-mapped IPv6 before range classification.
  for (const { address } of addresses) {
    try {
      const ip = ipaddr.process(address);
      const range = ip.range();
      if (range !== 'unicast') {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

// Known limitation: Azure platform/WireServer IP 168.63.129.16 is classified
// as unicast by ipaddr.js and not blocked by range checks. Azure IMDS itself
// is 169.254.169.254 and is blocked as link-local by the check above. For
// Azure deployments, add an explicit platform-IP policy or use ssrf-req-filter
// for socket-level protection.

// Use { redirect: 'error' } to prevent SSRF via redirects
async function safeFetch(url: string) {
  if (!(await isSafeUrl(url))) {
    throw new Error('URL not allowed');
  }
  return fetch(url, { redirect: 'error' });
}
```

**TOCTOU gap**: DNS resolution at validation time and at fetch time may resolve differently (DNS rebinding attack). Use `ssrf-req-filter` or equivalent to intercept at the socket level for critical security requirements.

---

## npm Audit Triage Decision Tree

```
Is the vulnerability reachable from production code?
├── No (dev dependency, test tool, build script only)
│   └── Defer with documented review date — LOW priority
└── Yes (production dependency)
    ├── Severity: Critical or High?
    │   ├── Fix available?
    │   │   ├── Yes → Fix immediately, block release if unfixed
    │   │   └── No → Document, assess exploitability, consider mitigation or replacement
    │   └── Severity: Moderate?
    │       ├── Fix available without breaking changes? → Apply in current sprint
    │       └── Requires major version bump? → Track, schedule, document
    └── Severity: Low?
        └── Track in backlog, defer with review date
```

**When no fix is available**: document the CVE, assess actual exploitability in context, apply any available mitigations (input validation, network controls), and set a calendar review date. Never close without a documented rationale.

---

## Supply-Chain Hygiene

- **Use `npm ci` in CI**, not `npm install` — `npm ci` uses the lockfile exactly and fails on mismatch
- **Commit `package-lock.json`** (or `yarn.lock`/`pnpm-lock.yaml`) — never `.gitignore` the lockfile
- **Review `postinstall` scripts** before running `npm install` on new packages — `postinstall` runs arbitrary code
- **Typosquat awareness**: verify package names before installing — `lodahs` vs `lodash`, `crossenv` vs `cross-env`
- **Prefer packages with high download counts and recent maintenance** — unmaintained packages accumulate CVEs
- **Pin exact versions** for dependencies with strong security surface (auth libraries, crypto)

---

## Security Review Checklist

### Authentication
- [ ] Every endpoint requiring authentication is protected
- [ ] JWT validated: signature, expiry, audience, issuer
- [ ] Session tokens invalidated on logout
- [ ] Refresh token rotation implemented
- [ ] MFA enforced where policy requires

### Authorization
- [ ] Authorization checked at resource level (not just route level)
- [ ] No IDOR: ownership check before returning or modifying any resource
- [ ] Privilege escalation prevented: no path from user to admin without explicit grant
- [ ] RBAC permissions documented and enforced in code

### Input Validation
- [ ] All user input validated at system boundary
- [ ] SQL queries parameterized or via ORM — no string concatenation
- [ ] HTML output escaped (no `innerHTML` with user data)
- [ ] File uploads: type, size, and filename validated; stored outside web root
- [ ] Path traversal prevented for any filesystem operations

### Data Protection
- [ ] Secrets in environment variables or secrets manager — not in code
- [ ] API keys, tokens excluded from logs
- [ ] PII excluded from error messages and stack traces
- [ ] `.env` in `.gitignore`
- [ ] TLS enforced for all external communications

### Infrastructure
- [ ] Security headers present: CSP, HSTS, X-Frame-Options, Referrer-Policy
- [ ] CORS policy restrictive (not wildcard unless intentional public API)
- [ ] Rate limiting on authentication endpoints, sensitive operations, and LLM calls
- [ ] Error responses do not leak stack traces or internal paths to clients

### Supply Chain
- [ ] `npm ci` used in CI pipeline
- [ ] Lockfile committed
- [ ] `npm audit` run with no unfixed critical/high in production dependencies
- [ ] `postinstall` scripts reviewed for new packages

### AI / LLM
- [ ] LLM output never passed to `eval()` or `innerHTML` without sanitization
- [ ] Prompt injection mitigations in place for any user-controlled context
- [ ] Agent action scope minimized; destructive actions require human confirmation
- [ ] RAG retrieval scoped by tenant/user — no cross-tenant data leakage
- [ ] Token limits set on all model calls

---

## Secret Rotation

**If a secret is ever committed to version control, rotate it immediately.**

Deleting the line from the file is insufficient — the secret remains in git history and may already be harvested. Rewriting history (`git filter-repo`) is also insufficient if the repository was ever pushed to a remote, forked, or cloned.

**Required steps when a secret is committed:**
1. Rotate the secret in the issuing system immediately (before history cleanup)
2. Assume the secret is compromised — audit access logs for unauthorized use
3. Rewrite history only after rotation, to prevent future accidental exposure
4. Notify security/compliance if the secret had access to customer data
