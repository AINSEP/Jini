---
name: slide-design
version: 0.1.0
last_updated: 2026-11-01
description: Use when planning, writing, designing, reviewing or fixing slides or a presentation deck (pitch, talk, teaching, status update, report or decision deck), including the storyline, slide titles, charts, 16:9 layout, speaker notes, accessibility and HTML decks.
---

# Skill: Slide Design

A good deck makes one point per slide, and the slides add up to one message.
This skill covers the thinking and the design. It renders nothing itself.

## Modes

- **New deck** — run the workflow below.
- **Fix my slide / fix my deck** — go to `references/review.md`, "Fix one slide".
- **Review only** — run the checklist in `references/review.md` and report by severity.
- **Outline only** — stop after step 3.

## Workflow

1. **Brief.** Get these. Ask only for what you can't infer; otherwise state your assumptions and go on.
   - Audience: who they are, what they already know, what they care about.
   - Goal: what they should think or do afterwards, in one sentence.
   - Setting: presented live, read alone, or both. Room, video call or printed.
   - Length: minutes available. Rough guide: 1 slide per 1–2 minutes when presented.
   - Deck type: pitch, talk, teaching, update, report or decision (`references/storyline.md`).
   - Brand: the host's theme, a brand the user gives, or the neutral default.
   - Material: data, images, logos, quotes and anything that must appear.
2. **Story shape.** Write the deck's message as one sentence. Pick the structure for the deck type
   (`references/storyline.md`).
3. **Titles-only outline.** List every slide as a takeaway title plus one line saying what evidence
   it will show. Read the titles alone: they must tell the story. Show the outline before building
   when the deck has more than 5 slides or the stakes are high. If the host runs without a user in
   the loop, show it and continue.
4. **Build.** For each slide: title, visual or text, speaker notes, source.
   Charts: `references/charts-and-exhibits.md`. Layout, type, colour, images, accessibility:
   `references/layout-and-style.md`. HTML output: `references/html-deck.md`.
5. **Review.** Run `references/review.md`. Fix every blocker before you hand the deck over.
   If the host can take screenshots, look at every slide.

## Core rules

1. One message per slide. The title states it as a full sentence.
2. Read in order, the titles tell the whole story.
3. Answer first in update, report and decision decks; detail follows.
4. The body proves the title. Anything else goes to notes or the appendix.
5. Show before you list: chart, diagram, image or big number before bullets.
6. Text must read from the back of the room: body at least 18 pt (36 px at 1920×1080).
7. Neutral colours plus one accent. The accent marks what to look at.
8. Everything sits on one grid. Titles, sources and slide numbers never move.
9. Every presented slide has speaker notes.
10. Accessible by default: contrast, alt text, reading order, never colour alone.

## Output

Default: an outline and slide specs in chat, one block per slide:

```
### 4. Churn fell by a third after the new onboarding shipped
Visual: line chart, monthly churn Jan–Dec; months after launch in accent; dashed line at the 6% target
On slide: "Launch, Mar" callout; y-axis "Monthly churn, %"
Notes: The point: onboarding fixed churn. Look at March... (40–120 words)
Alt: Line chart: churn fell from 8.1% to 5.4% after the March launch.
Source: Billing data, Jan–Dec 2026
```

Other outputs:
- **HTML deck** — one HTML document, one section per slide (`references/html-deck.md`).
- **PowerPoint, Keynote, Google Slides** — give the slide specs. Use a host export tool if one
  exists; this skill doesn't produce those files.

## Host tool use

- Find the host's tools first (tool search or tool list). Use what fits:
  - page or HTML tools to publish the deck;
  - theme tools to read colour and font tokens;
  - media tools to find or upload images;
  - screenshot tools to check each slide;
  - chart tools, if the host has them, to render charts.
- With no such tools, answer with slide specs, or one self-contained HTML file, in chat.
- Don't install packages or run shell commands to make a deck unless the host says you may.
- Ask before overwriting an existing page or deck.
- The host may add its own instructions. They win over this section.

## References

Load only what the task needs.

- `references/storyline.md` — deck types and their structures, answer-first, the opening, titles,
  summary slide, outline, closing slide, speaker notes.
- `references/charts-and-exhibits.md` — choosing a chart from the question, finishing it,
  tables, diagrams, grouping, numbers, icons.
- `references/layout-and-style.md` — 16:9 canvas, grid and spacing numbers, type sizes, density,
  colour roles, images, accessibility, slide types.
- `references/review.md` — checklist by severity, fixing one slide, long decks, final pass.
- `references/html-deck.md` — an HTML deck: structure, CSS, notes, printing to PDF, checks.
