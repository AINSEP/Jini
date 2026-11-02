# Rulepack: California — CCPA / CPRA

**Rulepack version:** 2026-08-26.1
**Applies when:** the site has California consumers and the business meets CCPA's own applicability
thresholds — which are **revenue and data-volume facts this skill cannot observe.** Always record
applicability itself as `cannot-determine` unless the operator states it.
**Versioned independently of SKILL.md.** Cite the entry id AND this version line.

> Patterns and evidence only. Nothing here authorises a compliance verdict — see the SKILL.md
> Output Contract.

---

## The posture difference that matters

CCPA/CPRA is **notice-and-opt-out**, not opt-in. A tracker firing before any consent action is not,
by itself, the same finding it is under EU-1 of the EU/UK rulepack. What matters here is whether
the required notices and opt-out mechanisms exist and work.

Do not carry an EU-1 finding over as a CCPA finding. Cite the same evidence separately, with the
reasoning appropriate to this rulepack.

---

## CA-1 — "Do Not Sell or Share My Personal Information" link

**Observe with:** the rendered link/heading inventory across the inspected pages, plus a direct load
of any candidate opt-out path.

**Supports `risk`:** a site where CA-3 observed advertising or cross-context behavioural
advertising requests, and no link whose accessible name matches "Do Not Sell", "Do Not Share",
"Your Privacy Choices", or an equivalent was found on any inspected page.

**Cite:** the pages inspected, and the exact text/selector query that returned nothing.

**`cannot-determine` when:** the link is conventionally in the footer of pages you did not load, or
is rendered by a consent platform only for visitors it geolocates to California — which a headless
browser from your server's egress IP will not be.

---

## CA-2 — Notice at collection

**Observe with:** page paths where personal data is collected (from the form-control inventory) and
the text near those forms.

**Supports `risk`:** a form collecting personal data with no notice, and no link to a privacy
policy, at or before the point of collection.

**Cite:** page path + the form's selector + the absence query used + the page's `textExcerpt` if it
demonstrates the absence.

**`cannot-determine`:** whether the notice's *categories and purposes* are accurate and complete —
that is a comparison against what the backend actually does with the data, which is not observable
from the page.

---

## CA-3 — Sale / sharing signals

**Observe with:** third-party requests and cookies, by host and resource type.

**Supports `observed`:** requests to advertising and identity-resolution hosts, and cookies
associated with cross-context behavioural advertising.

**Cite:** page path + host + pathname + resourceType + phase; cookie name + domain.

**`cannot-determine`, and say so loudly:** whether any of this constitutes a "sale" or a "share"
under CCPA. That turns on the contractual relationship with each recipient — a service-provider
agreement changes the answer entirely and is invisible from the page. Report the traffic; refuse
the characterisation.

---

## CA-4 — Global Privacy Control

**Supports `cannot-determine` by default:** whether the site honours a GPC signal
(`Sec-GPC: 1`) cannot be established by this tool. The evidence tool does not set request headers,
and there is no input by which it could be asked to.

State this explicitly rather than omitting it; GPC honouring is a specific CPRA obligation and a
silent omission reads as though it was checked.

---

## CA-5 — Consumer rights request mechanisms

**Supports `risk`:** no reachable page or form offering access, deletion, correction, or
know-what-we-collect requests, on a site where CA-3 observed sale/share-shaped traffic.

**Cite:** paths inspected and the query that matched nothing.

**`cannot-determine`:** whether requests are actually honoured, within the required window, with
the required verification. Behaviour behind a form is not observable.

---

## CA-6 — Financial incentives and non-discrimination

**`cannot-determine`, always.** Whether a loyalty programme or price difference is a permitted
financial incentive with the required notice, and whether a consumer exercising rights is
discriminated against, depends on business terms and backend behaviour.

Include this entry as an explicit `cannot-determine` if the site has anything resembling a
signup-for-discount flow, so the report does not appear to have cleared it.

---

## Out of scope for evidence collection

- Applicability thresholds (revenue, consumer counts, share of revenue from selling data).
- Service-provider and contractor contract terms.
- Actual honouring of opt-outs, GPC, and rights requests.
- Retention schedules and the CPRA storage-limitation disclosure's accuracy.
- Sensitive-personal-information limitation-of-use handling.
