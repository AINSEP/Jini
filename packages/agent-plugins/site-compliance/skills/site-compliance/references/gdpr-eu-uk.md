# Rulepack: EU / UK — GDPR, ePrivacy, PECR

**Rulepack version:** 2026-08-26.1
**Applies when:** the site has visitors in the EU/EEA (GDPR + ePrivacy Directive) or the UK
(UK GDPR + PECR). Consent posture in both is **opt-in**.
**Versioned independently of SKILL.md.** Cite the entry id AND this version line in every finding
that references it.

> This file describes patterns to look for and what evidence would support them. It does not
> determine legality. Nothing in it authorises a compliance verdict — see the SKILL.md Output
> Contract, which forbids one.

---

## How to use an entry

Each entry gives: what to observe, what evidence would support a `risk` status, and what makes the
question `cannot-determine`. Most entries have a `cannot-determine` clause that fires more often
than the `risk` one. That is expected and correct.

---

## EU-1 — Non-essential cookies or tags before consent

**Observe with:** `site_collect_page_evidence`, first with no `consentAcceptSelector` (everything
returns phase `before`), then again with one.

**Supports `risk`:** a cookie or request observed in the `before` phase that is plainly
non-essential — an analytics, advertising, session-replay, or social-embed host; a cookie whose
name matches a known tracker family (`_ga*`, `_fbp`, `_gcl_*`, `IDE`, `MUID`, `_hj*`).

**Cite:** page path + cookie name + domain + `phase: "before"`, or page path + request host + path
+ resourceType + `phase: "before"`.

**`cannot-determine` when:** the browser was unavailable; the page was not inspected; or you cannot
tell whether a given cookie is strictly necessary. **Necessity is a business fact, not an
observable one** — a first-party cookie named `sid` may be a login session (essential) or a
fingerprint (not). Report what you saw and say the necessity judgement needs the operator.

---

## EU-2 — Reject is not as easy as accept

**Observe with:** the rendered accessibility structure of the consent dialog: which controls exist
inside it, their accessible names, and their contrast samples.

**Supports `risk`:** an accept control present with no reject control at the same level; a reject
control whose accessible name is absent; a reject control with markedly lower contrast than accept.

**Cite:** the selector of each control found, its accessible name, and the contrast ratio of each.

**`cannot-determine` when:** the banner renders only after a delay or a geo-check the tool did not
trigger, or its controls live in a shadow root or cross-origin iframe the walk did not enter. Say
which.

---

## EU-3 — Consent withdrawal path

**Supports `risk`:** no control, link, or page anywhere in the inspected pages that offers to change
or withdraw a previously given consent, on a site where EU-1 found a consent banner.

**Cite:** the pages inspected and the selectors searched that matched nothing. Per the Output
Contract, an absence citation must name the exact query that returned nothing.

**`cannot-determine`, almost always, when:** withdrawal is offered from a footer link on a page you
did not load, or from a persistent floating control that only appears post-consent. Inspecting 5
pages does not establish absence across a site.

---

## EU-4 — Privacy notice reachability and substance

**Observe with:** load the candidate policy paths directly and read `document.httpStatus`,
`document.finalUrl`, `document.title`, and `document.textExcerpt`.

**Supports `risk`:** a non-200 status; a redirect to an unrelated page; boilerplate placeholder
text (`Lorem ipsum`, `[Company Name]`, `TODO`, `Your privacy policy goes here`, `Last updated:
[date]`); an empty body.

**Cite:** path, HTTP status, final URL, and the verbatim placeholder substring quoted.

**`cannot-determine` when:** the policy reads as real prose. Whether its *contents* satisfy Art.
13/14 (identity of the controller, legal bases, retention periods, transfer mechanisms, DPO
contact) is a legal reading of a document, not an observation, and this skill does not make it.

---

## EU-5 — Personal data collection points

**Observe with:** the form-control inventory (`accessibility.formControls`) plus the site profile's
content types and form definitions.

**Supports `observed` (rarely `risk`):** fields whose `name` or accessible name indicates personal
data (`email`, `phone`, `dob`, `address`, `nationalId`) — and especially special-category data
(health, biometric, political, religious, trade-union, sexual orientation, precise geolocation).

**Cite:** page path + selector + field name + accessible name. **Never the field's value** — the
evidence tool does not expose values and a report must not reconstruct them either.

**`cannot-determine`:** the lawful basis, the retention period, and whether the data is minimal for
the stated purpose. All three are operator facts.

---

## EU-6 — Third-party recipients and transfers

**Supports `observed`:** every distinct non-first-party request host seen on the inspected pages,
with the phase each was observed in.

**Cite:** page path + host + resourceType + phase.

**`cannot-determine`, always:** what those recipients do with the data, whether a processor
agreement exists, and which transfer mechanism (adequacy decision, SCCs, derogation) covers any
transfer outside the EEA/UK. None of that is on this server.

---

## EU-7 — Security-relevant response headers

**Supports `observed`:** presence or absence of `Strict-Transport-Security`,
`Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, and the `Set-Cookie`
attributes actually observed (`Secure`, `HttpOnly`, `SameSite`).

**Cite:** page path + exact header name and value, or cookie name + the flags observed.

**Note:** Art. 32 requires "appropriate" measures; a header inventory is an input to that
assessment and never the assessment itself. Report headers as `observed`, and the adequacy question
as `cannot-determine`.

---

## Out of scope for evidence collection

Named here so a report can list them as `cannot-determine` with a reason rather than omitting them
and looking complete:

- Records of processing activities (Art. 30) and DPIAs (Art. 35).
- Data subject request handling: identity verification, response timing, completeness.
- Retention and deletion actually performed on the backend.
- Processor and sub-processor contracts.
- Breach notification readiness.
- Whether a DPO is required or appointed.
