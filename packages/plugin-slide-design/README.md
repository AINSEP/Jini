# `@jini-ai/plugin-slide-design`

Portable Agent Plugins payload with one skill, `slide-design`: planning, writing, designing and
reviewing slide decks. Installing this package downloads only this plugin; it has no runtime or
plugin dependencies, no MCP server and no executable tools.

Resolve `@jini-ai/plugin-slide-design/plugin.json` with the host's package resolver. Its containing
directory holds the payload. Copy that directory beneath the host's bundled-source root, then use
`@jini-ai/agent-plugins/lifecycle` to seed it, exactly as for `@jini-ai/plugin-ui-ux-design`.
Host policy controls activation; installing this npm package grants no permission.

The npm version follows Jini's fixed release group. The inner `plugin.json` version is **0.1.0**
and changes only when the skill content changes. The `./slide-design/*` export exposes the raw
assets for host staging.

Sources live in `packages/agent-plugins/slide-design`. The build and prepack script
(`scripts/assemble-agent-plugin-package.ts slide-design`) generates only `slide-design/` here.

## What the skill covers

- `SKILL.md` — modes (new deck, fix a slide, review, outline only), the workflow
  (brief → story shape → titles-only outline → build → review), core rules, output format and
  generic host tool use.
- `references/storyline.md` — deck types (investor and sales pitch, talk, teaching, update,
  report, decision), answer-first structure, openings, takeaway titles, summary and closing
  slides, speaker notes.
- `references/charts-and-exhibits.md` — chart choice by question, finishing a chart, tables,
  diagrams, numbers, icons.
- `references/layout-and-style.md` — 16:9 grid and spacing numbers, projected type sizes,
  density, colour roles, images, accessibility, slide types.
- `references/review.md` — checklist by severity, fixing one slide, long decks.
- `references/html-deck.md` — a printable, theme-aware HTML deck plus a zoomable reading and
  speaker copy.

## Host guidance

The skill's tool guidance is generic: use the host's page, theme, media, chart and screenshot
tools when present, otherwise answer with slide specs or HTML. Hosts add their own
product-specific instructions (tool names, publishing rules) through their own prompt or plugin
wiring, not by editing this payload.

PowerPoint, Keynote and Google Slides export are not included.
