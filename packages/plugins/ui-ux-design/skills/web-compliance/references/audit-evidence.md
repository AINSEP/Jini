# Audit Evidence

Use this reference when `web-compliance` findings need stronger remediation framing or evidence collection structure.

## When to Use

- medium or high risk findings
- consent and tracking controls
- DSR/export/delete/account-control flows
- subscription or cancellation parity
- vendor/script introductions
- age-gating and regulated onboarding flows

## Gap Record Template

For each medium/high finding, capture:

- `control_area`: short label for the compliance concern
- `current_state`: what the product does today
- `target_state`: what must be true for launch
- `remediation_steps`: concrete next actions
- `estimated_effort`: small, medium, large or time estimate
- `evidence_needed`: what must be shown to verify the fix

Example:

```yaml
control_area: consent-logging
current_state: Analytics consent banner is shown, but no evidence of consent timestamp or policy-version capture exists.
target_state: Consent grant, rejection, and withdrawal are recorded with timestamp, policy version, and scope.
remediation_steps:
  - Add server-side consent event persistence
  - Include policy/version identifier in stored consent records
  - Add withdrawal path and verify revocation updates persisted state
estimated_effort: medium
evidence_needed:
  - code path for persistence
  - database schema or event payload
  - UI flow showing withdrawal path
  - test or network proof that records are written
```

## Evidence Matrix

When multiple findings exist, summarize expected evidence with:

| Control Area | Evidence Type | Source | Collection Method | Verification Step |
|---|---|---|---|---|
| Consent logging | `code`, `network`, `config` | backend endpoint + client flow | inspect code and capture browser network | verify grant/reject/withdraw all persist |
| Pre-consent blocking | `network`, `config` | tag manager or edge config | browser/network trace before consent | confirm no non-essential tags fire |
| Cancellation parity | `ui-copy`, `flow-path` | account settings flow | walkthrough + screenshots | compare sign-up vs cancel discoverability |

## Evidence Rules

- Prefer direct evidence over policy promises.
- Mark missing proof as `missing evidence`.
- Group related findings when one remediation fixes several symptoms.
- Do not infer backend controls from frontend copy alone.
- Do not mark a control complete unless the operating behavior can be shown.
