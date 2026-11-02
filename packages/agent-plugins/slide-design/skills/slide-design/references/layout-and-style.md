# Layout and style

All sizes are for a 16:9 slide designed at 1920×1080 px. On a 13.33 × 7.5 in slide
(PowerPoint's 16:9 default), 1 pt = 2 px.

## Canvas and grid

- **Margins (safe area):** 96 px left and right, 80 px top, 64 px bottom. All text stays inside.
  Full-bleed images may run to the edge.
- **Grid:** 12 columns inside the margins, 24 px gutters. Content width 1728 px, each column
  122 px.
- **Common splits:** 12 (full width), 6 + 6, 4 + 8 (text + visual), 8 + 4 (visual + text),
  4 + 4 + 4, 3 + 3 + 3 + 3.
- **Spacing scale:** 8, 16, 24, 32, 48, 64, 96 px. Use 16–24 inside a group and 48–64 between
  groups. The same relationship always gets the same gap.
- **Title zone:** starts at the top margin, same place on every slide, up to 2 lines.
  Body starts about 240 px from the top.
- **Footer zone (optional):** the bottom 48 px. Source on the left, slide number on the right.

## Type

| Role | Size at 1920×1080 | Points |
|---|---|---|
| Title | 64–88 px | 32–44 pt |
| Statement or section title | 96–128 px | 48–64 pt |
| Big number | 160–240 px | 80–120 pt |
| Body, presented | 40–48 px, never below 36 px | 20–24 pt, never below 18 pt |
| Body, read alone | 28–32 px, never below 24 px | 14–16 pt, never below 12 pt |
| Chart labels, captions | at least 28 px | at least 14 pt |
| Source, footer | 20–24 px | 10–12 pt |

- **Back-of-room test:** shrink the slide to a quarter of its size on screen. If you can't read
  it, people at the back can't either.
- Lines up to about 60 characters. Line height 1.1–1.2 for titles, 1.3–1.4 for body.
- At most 2 typefaces, or 1 family in 2 weights. Use the host theme's fonts when there are some.
- Left-align text. Centre only title slides, statements and big numbers.
- Emphasis by weight or the accent colour, not underline or long italics.
- No all-caps sentences. Caps are fine for short labels with a little letter spacing.

## Density

- One message per slide, one focal point. The eye should land on the accent first.
- Word budget, excluding chart labels: about 30 words presented, about 80 read alone.
- Bullets: 3–5 per slide, at most 2 lines each, one level deep.
- Too much? Split the slide, move detail to notes, or move it to the appendix.
- Too little, or the same point as the slide before? Merge.

## Alignment and grouping

- **Proximity:** related things close, unrelated things apart. The gap between groups is at least
  twice the gap inside a group.
- **Similarity:** items of the same kind look the same: size, colour, shape.
- **Alignment:** every edge sits on a grid line. Title and body share one left edge.
- **Repetition:** equal gaps between repeated items, equal sizes for parallel boxes.
- **Consistency:** title, logo, source and slide number stay put across slides.
- **Squint test:** blur your eyes or view a thumbnail. You should still see the structure and
  the focal point.

## Colour

Where colours come from, in order:

1. The host's theme tokens (primary or accent, text, background, fonts), read with its theme tools.
2. A brand the user supplies: hex codes, logo, fonts.
3. The neutral default: text #1A1A1A on #FFFFFF or #FAFAF7, greys #6B6B6B and #D4D4D4 for
   secondary text and muted data, one accent #2563EB.

Rules:

- Give colours roles: background, text, muted text, neutral data, accent, and optionally
  good and bad. Don't pick colours slide by slide.
- One accent per slide for "look here". Use shades of one hue before adding a second hue.
- The same colour means the same thing across the deck (product A is always teal).
- Light backgrounds suit read-alone decks and printing. Dark ones suit talks in dim rooms. Pick
  one per deck.
- At most about 5 colours in one chart. Group the rest as "Other".

## Images

- Show the real thing: the product, the people, the place. Skip generic stock.
- Give images real space: full-bleed or a whole grid cell, not a small floating picture.
- Text on an image only over a calm area or a dark overlay (at least 50% opacity), and the text
  must still pass contrast.
- Full-bleed images need at least 1920 px of width. Crop, never stretch.
- Use only images the user owns, has a licence for, or generated with permission. Credit when
  required.
- Logos: official files, original colours, same visual height in a row.
- Generated images: one style across the deck, no fake text inside them, check hands and faces,
  show people inclusively.

## Accessibility

- **Contrast:** text at least 4.5:1 against its background. Large titles and chart marks at
  least 3:1.
- **Never colour alone:** add labels, patterns, icons or arrows. Avoid red and green pairs; blue
  and orange read for most people.
- **Alt text** for every meaningful image and chart. Say the point, not the look:
  "Line chart: churn fell from 8.1% to 5.4% after the March launch." Decorative images get empty
  alt text.
- **Reading order:** title first, then content in the order you'd present it. In HTML that is the
  source order; in slide apps, set the object order.
- **Unique titles:** screen reader users jump between slides by title.
- **Motion and media:** captions for video and audio, no flashing more than 3 times a second,
  little motion.
- **Plain words:** spell out an acronym the first time it appears.
- Share the deck and notes as a file people can open on their own device.

## Builds and transitions

- Use builds only to reveal points in the order you speak them.
- One transition for the whole deck: a fade or none. No flying or spinning.

## Slide types

| Type | Layout |
|---|---|
| Title | Deck title, subtitle, presenter, date. Left-aligned or centred. |
| Agenda | 3–5 items in the words the section dividers use. |
| Section divider | Section name large, optional number. |
| Statement | One sentence, 96–128 px, lots of space. |
| Big number | The number, what it measures, its comparison. |
| Chart | Takeaway title, chart over 8–12 columns, source in the footer. |
| Text + visual | Text in 4 columns, visual in 8. |
| Comparison | 2–4 equal columns with the same rows. |
| Process | 3–6 steps across. |
| Quote | The quote large, the person's name and role small. |
| Full-bleed image | The image, plus at most one line of text. |
| Summary | Message, 3–4 reasons, the ask. |
| Closing | Message, ask or next step, contact. |
| Appendix | Its own divider, then backup slides with full detail. |
