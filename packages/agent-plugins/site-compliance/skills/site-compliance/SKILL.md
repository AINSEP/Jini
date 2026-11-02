---
name: site-compliance
description: Evidence-based privacy, cookie/consent, and accessibility risk screening for this site. Gathers citable evidence from site configuration and from the site's own rendered pages, then reports findings that each carry the exact page path, selector, header, cookie, or network request that supports them. Says "cannot determine" wherever the evidence is missing. Never states that a site is or is not GDPR, CCPA/CPRA, or WCAG compliant.
---

# Site Compliance — evidence, not verdicts

## What this skill is

A **risk screening** procedure. It produces a list of observations about this site, each one
anchored to a piece of evidence somebody else can go and re-check.

## What this skill is not

It is not legal advice, not a conformance audit, not a certification, and not a compliance
verdict. It has no way to see the things that actually decide most compliance questions:
your data-processing agreements, your retention practices, your sub-processors, your internal
procedures, what your vendors do with the data after it leaves this server, or which
jurisdictions your users are actually in.

**A compliance conclusion is not yours to make.** Read the Output Contract below before you
write a single line of a report — it is the part of this skill that matters most, and it is
not negotiable.

---

## Output Contract (non-negotiable)

### 1. Every finding carries evidence, and the evidence is a citation

A finding without a citation is not a finding — it is a guess, and you must delete it rather
than ship it. Every single finding must name **where you observed it**. A citation is one of:

| Evidence kind | Citation must include |
|---|---|
| Rendered page structure | the page **path** and the **CSS selector** (plus the element's tag and any accessible name) |
| Cookie | the page path, the **cookie name**, its **domain**, and **whether it was set before or after a consent action** |
| Network request | the page path, the **request URL's host and path**, its **resource type**, and **whether it fired before or after a consent action** |
| Response header | the page path and the **exact header name and value** |
| Page text | the page path and the **verbatim quoted substring** (short — a sentence, not a paragraph) |
| Site configuration | the **profile section name and field path** the value came from |
| Absence of something | the page path(s) actually inspected and the **exact query that returned nothing** |

Write the citation inline with the finding. Not in an appendix, not "see the evidence
section" — beside the claim it supports.

### 2. Every finding gets a status from this fixed vocabulary

Use exactly these four. Do not invent a fifth, and do not substitute a compliance word.

- **`observed`** — you saw this, here is the citation. A neutral statement of fact.
- **`risk`** — what you observed is a recognised risk pattern. Say which rulepack entry it
  maps to, and say plainly what a reviewer should look at. Never "this violates GDPR".
- **`cannot-determine`** — the evidence needed to say anything is not available to you. Say
  *why*: not inspected, tool unavailable, page unreachable, requires a human, requires
  information that does not exist on this server.
- **`not-assessed`** — you did not look. Say why you did not look (out of scope for this run,
  page count cap reached, operator narrowed the scope).

### 3. Banned outputs

Never emit, in any wording:

- "This site is GDPR compliant" / "non-compliant" / "compliant" / "in violation" / "passes" /
  "fails" — for any regulation or standard, with or without hedging adverbs.
- A score, a grade, a percentage, or a pass/fail count that reads as a verdict.
- A legal conclusion about whether a given practice is lawful.
- A claim about anything you did not personally observe this run. If the evidence tool
  returned `unavailable`, you observed nothing — say `cannot-determine`.
- A claim that a check "passed" because the tool returned no evidence. **No evidence is not
  evidence of absence.** If cookies could not be observed, cookies were not observed; that is
  `cannot-determine`, never "no tracking cookies found".

### 4. "Cannot determine" is a required output, not a fallback

You are expected to emit `cannot-determine` findings on every real run, and a report with
none is a suspicious report. In particular, always emit `cannot-determine` for:

- Anything that depends on a contract, a vendor's internal behaviour, a retention schedule,
  or an organisational procedure.
- Anything requiring a human judgement about the site's actual business (is this data
  "necessary"? is this a "sale" of personal information?).
- Any page or section that was **inaccessible** — behind auth, returned a non-200 status,
  timed out, was excluded by the page cap, or was skipped because the browser runtime is not
  present in this deployment. Name each one individually with its path and the reason.

### 5. Report skeleton

```
# Site compliance screening — <site> — <date>

**This is a risk screening, not a compliance audit and not legal advice.**
No statement below asserts that this site does or does not comply with any law or standard.

## What was inspected
- Pages actually loaded: <n> — <list the paths>
- Configuration sections read: <list>
- Browser evidence: available | unavailable (<reason>)
- Consent-transition evidence: collected | not collected (<reason>)

## What was NOT inspected, and why
- <path or area> — <reason>   (one line each; this list is never empty)

## Findings

### <area> — <short title>
- **Status:** observed | risk | cannot-determine | not-assessed
- **Evidence:** <citation, per the table above>
- **Why this matters:** <one or two sentences, referencing the rulepack entry id>
- **Suggested next step for a human reviewer:** <concrete, specific>

## Open questions for the operator
- <the jurisdiction / business-fact questions you could not answer yourself>
```

---

## Procedure

### Step 0 — establish scope before collecting anything

Ask the operator, and record the answers in the report:

1. Which regions do your visitors come from? (This changes which rulepack applies and, in
   opt-in regions, changes what "before consent" means.) If unknown, say so and screen
   against the strictest applicable rulepack, marking the jurisdiction assumption explicitly.
2. Which pages matter most? (Home, a form page, checkout, the policy pages.)
3. Is there a consent banner, and if so, how does a visitor accept it? You need the selector
   or the visible label to be able to observe a before/after transition at all.

If the operator cannot answer 1, that alone produces a `cannot-determine` in the report. Do
not silently pick a jurisdiction.

### Step 1 — configuration truth

Call `site_get_profile` for the sections you need — typically `pages`, `settings`, `theme`,
`plugins`, `contentTypes`. Prefer a narrow `sections` list; a full profile is mostly context
you will not cite.

What the profile can tell you: which policy pages exist as content, which widgets/plugins are
installed and enabled, which content types and forms collect fields that look like personal
data, what the theme declares.

**What the profile cannot tell you, ever:** what the published page actually renders. A
consent widget can be installed and enabled in configuration and render nothing at all on the
live page. Treat every configuration fact as a *hypothesis about the rendered site*, and
either confirm it against rendered evidence in Step 2 or downgrade it to
`cannot-determine`. Never promote a configuration fact into a statement about live behaviour.

If a profile section comes back `forbidden`, that is a `cannot-determine` for everything that
depended on it — say which section and that access was denied.

If `site_get_profile` is not available in this deployment at all, say so plainly and continue with
Step 2 alone. Rendered evidence without configuration context is still real evidence; what you lose
is the ability to cross-check a configuration claim against it, and that loss belongs in the "What
was NOT inspected" section.

### Step 2 — rendered truth

Call `site_collect_page_evidence` for each in-scope page path. It loads **this site's own**
published pages in a real browser and returns what was actually observed. It refuses
off-origin URLs, caps how many pages and how long it will run, never submits a form, and
never persists what it captured.

Use it for exactly the things configuration cannot answer:

- **Pre-consent cookies and requests.** Request `consentAction: "none"` first, and read
  `cookies` and `requests` from the result. Every entry is stamped with the phase it was
  observed in.
- **The consent transition.** If the operator gave you an accept selector, request the
  `accept` phase too, and compare the two phases. What appears only in the `after` phase was
  gated; what appears in `before` was not.
- **Rendered accessibility structure.** `accessibility` carries landmarks, the heading
  outline, images and their alt text, form controls and their label associations, and
  contrast samples — each with the selector it came from.
- **Policy-page reachability and placeholder text.** `documentSummary` carries the final
  status, the final URL after redirects, the title, and text excerpts you can quote.

If the tool returns `status: "unavailable"`, the browser runtime is not installed in this
deployment. **Every rendered-truth finding then becomes `cannot-determine` with that
reason.** Do not fall back to guessing from configuration and do not soften the wording.

Never ask this tool to submit a form, log in, or visit a third-party URL. It will refuse, and
asking is a sign you have drifted out of scope.

### Step 3 — map evidence to rulepack entries

Load only the rulepacks in scope. Each is versioned independently of this file, so quote the
entry id and the rulepack's own version line when you cite it.

- `references/gdpr-eu-uk.md` — EU/UK: GDPR + ePrivacy/PECR. Opt-in consent posture.
- `references/ccpa-cpra.md` — California: CCPA/CPRA. Notice-and-opt-out posture.
- `references/wcag-2-2.md` — WCAG 2.2 AA, restricted to what a rendered page can evidence.

A rulepack entry tells you what pattern to look for and what evidence would support it. It
does **not** tell you whether the site is lawful, and neither do you.

### Step 4 — write the report

Follow the skeleton above. Before you submit it, re-read your own draft and delete:

- every finding whose evidence line does not name a real path/selector/header/cookie/request,
- every sentence containing a banned output from §3,
- every "no issues found" that is really "did not observe".

Then check the "What was NOT inspected" section is non-empty. If it is empty, you have
almost certainly overstated your coverage — go back and list what you skipped.

---

## Standing constraints

- **Read-only.** This procedure never changes site content, settings, or configuration. If
  the operator asks you to fix something, that is a separate task with separate consent.
- **No personal data in the report.** If a page or a form submission exposes real user data,
  do not copy it into findings. Cite the selector and the field name, never the value.
- **Third-party pages are out of scope.** You can observe that a request went to
  `example-analytics.com`; you cannot observe what happens there.
- **Say when you are guessing.** If you are inferring rather than observing, the status is
  `cannot-determine`, and the word "likely" does not upgrade it.
