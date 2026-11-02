# Rulepack: Accessibility — WCAG 2.2 Level AA

**Rulepack version:** 2026-08-26.1
**Scope of this file:** only the success criteria a **rendered-page observation** can produce real
evidence for. Roughly a quarter of WCAG 2.2 AA is machine-observable at all; the rest needs a human
with a keyboard, a screen reader, or knowledge of the content's meaning.
**Versioned independently of SKILL.md.** Cite the entry id AND this version line.

> Patterns and evidence only. **Never report a site, page, or criterion as "WCAG AA compliant" or
> "non-compliant"** — see the SKILL.md Output Contract. A criterion with no observed failures is
> `cannot-determine`, not `pass`: automated observation is well documented to detect only a minority
> of real accessibility barriers.

---

## A-1 — 1.1.1 Non-text Content: images without alternative text

**Observe with:** `accessibility.images`.

**Supports `risk`:** an image with `alt: null` (the attribute is absent) and `ariaHidden: false`.

**`alt: ""` is NOT a finding.** An explicitly empty alt is the correct marking for a decorative
image. The evidence tool distinguishes the two deliberately; do not collapse them.

**Cite:** page path + selector + `src` + the observed `alt` value (`null` vs `""`).

**`cannot-determine`:** whether a *present* alt is actually a good description. That requires
understanding what the image conveys.

---

## A-2 — 1.3.1 Info and Relationships: form controls without a programmatic label

**Observe with:** `accessibility.formControls`.

**Supports `risk`:** a control with `accessibleName: null` and `labelSource: "none"`.

**Weaker signal, report as `observed`:** `labelSource: "title"` — a `title` attribute is a
last-resort accessible name and is not exposed consistently.

**Cite:** page path + selector + tag + type + `name` + `labelSource`.

**`cannot-determine`:** whether a present label is meaningful, and whether grouped controls
(radio/checkbox sets) have the right `fieldset`/`legend` grouping — the evidence tool does not
capture grouping.

---

## A-3 — 1.3.1 / 2.4.6 Heading structure

**Observe with:** `accessibility.headings`, which is in document order with levels.

**Supports `risk`:** no `h1` at all; more than one `h1`; a level skipped going down (h2 → h4);
a heading whose `text` is empty.

**Cite:** page path + the heading outline as observed (level + selector + text), so the skip is
visible in the citation itself rather than asserted.

**`cannot-determine`:** whether headings describe their sections accurately.

---

## A-4 — 1.4.3 Contrast (Minimum)

**Observe with:** `accessibility.contrastSamples`. Each carries the computed ratio, font size, and
weight.

**Supports `risk`:** ratio below 4.5:1 for normal text, or below 3:1 for large text (≥ 24px, or
≥ 18.66px at weight ≥ 700). Report the threshold you applied alongside the ratio.

**Cite:** page path + selector + foreground + background + ratio + fontSizePx + fontWeight.

**`cannot-determine` — and this one matters:** the sample set is capped and covers only leaf text
elements the walk reached. A page with no sampled failures has not been shown to pass. Also flag
that the background is resolved by walking ancestors for the first opaque colour, so text over an
**image or gradient** produces a ratio computed against a colour that is not really behind it.
Where a sample looks suspicious, say the measurement method may not apply rather than reporting the
number as fact.

---

## A-5 — 1.3.6 / 2.4.1 Landmarks and bypass mechanisms

**Observe with:** `accessibility.landmarks`.

**Supports `risk`:** no `main` landmark; multiple `navigation` landmarks with no distinguishing
accessible names; no `banner`/`contentinfo` on a page that clearly has a header and footer.

**Supports `observed`:** the landmark inventory as found.

**Cite:** page path + role + selector + accessibleName for each.

**`cannot-determine`:** whether a skip link exists and works — it is typically visually hidden until
focused, and the evidence tool performs no keyboard interaction.

---

## A-6 — 3.1.1 Language of Page

**Observe with:** `document.lang`.

**Supports `risk`:** `lang: null`.

**Cite:** page path + the observed value.

**`cannot-determine`:** whether the declared language matches the actual content, and whether
inline language changes (3.1.2) are marked.

---

## Explicitly NOT assessable by this tool

List these in every accessibility report as `cannot-determine`, with this rulepack cited as the
reason. Omitting them makes a report look far more complete than it is.

- **2.1.1 / 2.1.2 Keyboard, No Keyboard Trap** — no keyboard interaction is performed.
- **2.4.3 Focus Order** and **2.4.7 / 2.4.11 Focus Visible / Not Obscured** — focus is never moved.
- **2.4.13 Focus Appearance**, **2.5.7 Dragging Movements**, **2.5.8 Target Size** — needs layout
  measurement and interaction the tool does not do.
- **1.4.10 Reflow**, **1.4.4 Resize Text** — requires loading at multiple viewport sizes.
- **2.2.1 Timing Adjustable**, **2.2.2 Pause, Stop, Hide** — requires observing behaviour over time.
- **1.2.x Time-based Media** — captions, audio description, transcripts.
- **3.2.x On Focus / On Input / Consistent Help** — requires interaction across multiple pages.
- **3.3.x Error Identification, Labels, Error Prevention, Accessible Authentication** — requires
  submitting forms, which this tool **never** does.
- **4.1.2 Name, Role, Value** for custom widgets — requires driving the widget's states.

If an operator needs these covered, the honest answer is a manual audit or an interactive testing
tool, and the report should say so rather than implying the gap does not exist.
