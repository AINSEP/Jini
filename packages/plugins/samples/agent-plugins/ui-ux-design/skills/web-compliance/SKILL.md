# Web Compliance

## Purpose
Provide a practical compliance checklist for website-facing features so review agents can consistently catch legal and policy risks before release.

## Scope
This skill is a risk-screening layer for product and engineering workflows, not legal advice. It helps teams surface issues early and escalate to legal/privacy/security reviewers when needed.

## Jurisdiction Baseline
Apply checks based on the strictest applicable region for the release scope.

- EU/EEA: GDPR + ePrivacy (opt-in consent for non-essential cookies/tracking)
- UK: UK GDPR + PECR (similar consent posture to EU)
- California: CCPA/CPRA (notice + opt-out model for "sale/share" contexts)
- Canada: PIPEDA/CASL (privacy + strong marketing consent requirements)
- US (SMS): TCPA constraints for promotional SMS consent and disclosures

If target regions are unknown, mark as `high` uncertainty and escalate for legal confirmation before launch.

## Use When
- Feature introduces forms, tracking, cookies, analytics, personalization, ads, or user-generated content
- Feature changes terms, pricing, claims, consent text, email/SMS capture, account creation, or account deletion flows
- Feature impacts regional availability or age-restricted experiences

## Core Checklist

### Privacy and Data Handling
- Personal data collection points are explicit and minimal for the feature goal
- Sensitive/special-category data is identified and handled with elevated controls where required (for example: health data, racial/ethnic origin, religious beliefs, political opinions, genetic data, biometric data, sexual orientation, trade union membership, precise geolocation where regulated)
- Privacy notice and just-in-time disclosures are present where data is collected
- Consent and preference choices are explicit where required (no hidden defaults)
- Data retention/deletion expectations are reflected in UX copy and flow behavior
- Data subject request (DSR) mechanisms exist and are usable for access/export/deletion/portability where required
- DSR identity verification and response-path UX are defined (do not rely on policy copy alone)
- DSR flow communicates expected response timing/status updates where required (for example: GDPR typically 1 month with permitted extension; CCPA typically 45 days with permitted extension)
- Frontend collection fields and backend validation contract align (no unexpected extra data accepted)
- Cross-border data transfer implications are identified for relevant vendors/services and escalated when transfer mechanism evidence is unclear
- Sensitive fields use safe defaults for storage/autofill behavior appropriate to risk

### Tracking and Consent
- Non-essential tracking is gated behind consent where required
- Consent state is honored across page loads and third-party tags
- "Reject" and "Manage preferences" paths are as visible as "Accept"
- Consent withdrawal/revocation is as easy and discoverable as consent grant where required
- Consent actions are auditable (timestamp, policy/version context, and scope) where required
- No non-essential cookies/tags/pixels fire before valid consent in opt-in regions
- Consent categories are explicit (for example: necessary, functional, analytics, marketing)
- Consent UI has no pre-checked boxes and no coercive "cookie wall" patterns where prohibited
- Region-based consent behavior is enforced server/edge-side, not only via frontend display toggles
- Push notification permissions are requested with clear purpose/context and respect prior denial/dismissal patterns

### Claims and Marketing Content
- Product/marketing claims are specific and supportable (avoid unverifiable absolutes)
- Pricing, trial, and renewal details are clear in the same flow where commitment happens
- Required disclosures are placed near relevant calls to action
- Subscription cancellation path is at least as discoverable and easy as sign-up
- Cancellation is available through the same primary medium as sign-up where required (for example, online sign-up implies online cancellation path)
- Negative option billing/auto-renew enrollment uses explicit affirmative consent separate from bundled legal text where required
- Free-trial to paid conversion terms are explicit before commitment
- Material ToS/pricing/renewal-term changes trigger proactive user notice and re-consent/acknowledgment checks where required

### Email/SMS Capture and Messaging
- Email capture flow includes clear sender identity and functional unsubscribe path
- SMS capture includes explicit consent language, program identity, and opt-out instructions where required
- Messaging consent scope matches actual campaign behavior (no silent purpose expansion)

### Third-Party Scripts and Vendors
- New third-party scripts/SDKs/pixels/iframes are inventoried in the change review
- Data-sharing impact is assessed as a potential new vendor/subprocessor risk
- Vendor data flows are reflected in disclosures/policies where required
- Non-essential third-party scripts are technically blocked until consent state permits execution

### User Rights and Account Controls
- Account creation, sign-in, and recovery flows avoid dark patterns (confirm-shaming, roach motel, hidden costs, forced continuity)
- Account deletion/deactivation flow is discoverable and not materially harder than sign-up
- Contact and complaint/reporting channels are visible for regulated or trust-sensitive features
- If automated decisioning materially affects users (for example eligibility, ranking, moderation outcomes), disclosure and human-review escalation path are present where required
- For personalization/targeting profiles, objection and opt-out controls are discoverable and honored where required

### Age-Restricted Experiences
- Age gate behavior is neutral and non-deceptive
- Child-directed and "actual knowledge of minor user" risk cases are flagged for legal review before release
- Data handling and consent flows for minors are not inferred; require explicit policy/legal alignment

### Accessibility and Fairness
- Compliance-related controls are usable with keyboard and assistive technologies
- Critical disclosures are not conveyed by color alone
- Consent and policy controls are understandable at normal reading level
- For EU-market digital products, include European Accessibility Act (EAA) applicability check in addition to WCAG baseline validation

### UGC and Platform Governance
- If user-generated content is in scope, reporting, enforcement notice, and appeal pathways are defined where required
- Recommender/ranking controls avoid manipulative defaults and are communicated in clear user-facing terms

## Output Contract
When this skill is applied, output should include:
- Findings list with `risk_level` (`high`, `medium`, `low`)
- Exact file/flow references
- User-facing and regulatory impact
- Recommended remediation or escalation target (legal/privacy/security/product)
- Jurisdiction assumptions used for each finding
- Verification evidence type (`code`, `config`, `network`, `ui-copy`, `flow-path`)
- Explicit uncertainty notes when legal interpretation is required
- For `high` and `medium` findings, add audit-style gap framing:
  - `control_area`
  - `current_state`
  - `target_state`
  - `remediation_steps`
  - `estimated_effort`
  - `evidence_needed`

## Audit-Style Evidence Layer
- Use audit-style gap framing when the feature touches consent logging, DSR flows, retention/deletion behavior, vendor/script controls, cancellation parity, or age-gating.
- If multiple findings share the same root cause, group them into one remediation cluster and list shared evidence needed.
- If evidence cannot be verified from code or config, mark it as `missing evidence` rather than assuming compliance.
- When useful, load `<AI_DEV_SHOP_ROOT>/skills/web-compliance/references/audit-evidence.md` for gap templates and evidence-matrix structure.

## Escalation Routing Heuristics
- Route to `legal` for jurisdiction interpretation, cross-border transfer mechanism questions, ToS/pricing term changes, marketing claims substantiation, and minor/age-gating edge cases.
- Route to `privacy` for consent model mismatches, DSR/portability flow gaps, profiling objection controls, retention/deletion mismatches, and disclosure scope misalignment.
- Route to `security` for backend/edge enforcement failures (for example pre-consent tag firing), identity-verification weaknesses in DSR flows, and third-party data exfiltration risk.
- Route to `product` for UX dark patterns, cancellation discoverability parity, disclosure placement/copy clarity, and funnel-level remediation sequencing.
- If a finding spans multiple domains, assign primary owner by root cause and list secondary owners explicitly.

## Guardrails
- Do not present this skill as legal advice
- Do not block release on low-confidence assumptions; escalate with explicit uncertainty
- Prefer concrete evidence (copy text, UI path, config behavior) over generic warnings
- Do not claim certification or framework readiness from website-surface checks alone
