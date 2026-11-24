# Calendly plugin

Shows a Calendly booking calendar on a site page. A public Calendly link is all it needs; the
optional Calendly sign-in only lets the assistant look up event types.

## The `booking-calendar` export needs a `url`, by design

`exports/booking-calendar.html` renders `{{props.url}}` twice (the iframe `src` and the fallback
link) and gives it no default. That is intentional, not a gap:

- The fragment grammar has **no conditionals and no default values**. A template cannot say "use
  this link unless the author gave none".
- `url` is `required` in the manifest's `props` schema, so the host refuses a marker without it.
  Even if a marker slipped past schema validation, `fillPluginExportTemplate` throws
  `unknown plugin export slot` for a slot with no value. A missing slot never leaks `{{props.url}}`
  into the page.
- A refused export is isolated to that one occurrence: `resolvePluginExportEmbeds` keeps the
  author's own fallback markup inside the marker, and the rest of the page renders normally.
  The page author sees their fallback, not a broken frame and not a failed page.

Pinned by `packages/cms/src/widgets/__tests__/plugin-export.unit.test.ts` (a missing slot throws
`unknown plugin export slot`; an unresolved export keeps the authored fallback and the next
occurrence still renders).

## Do not put a note in the template itself

The fragment keeps HTML comments. A `<!-- ... -->` added to `booking-calendar.html` is copied
into every published page that uses the calendar (checked against `fillPluginExportTemplate`).
Comments that mention `{{` or `}}` are refused outright. Keep design notes here instead.
