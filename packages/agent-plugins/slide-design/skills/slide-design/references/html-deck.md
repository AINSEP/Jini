# HTML deck

Build the deck as one HTML document when the host can publish pages or HTML, or when the user
wants a file. It works in any browser, presents full screen, and prints to PDF.

## Structure

- One document. One `<section class="slide">` per slide, in presenting order.
- Each slide has one heading: `<h1>` on the title slide, `<h2>` on the rest. Unique wording.
- Speaker notes go in `<aside class="notes">` as the slide's last child. Hidden on screen.
- Use real elements: lists, `<figure>` and `<figcaption>`, `<img alt>`, `<table>` with `<th>`.
- Source order is the reading order: title, then content in speaking order, then source.
- No script is needed. Scroll snap steps through slides with arrow and Page Down keys.
- All sizes are written in design pixels at 1920×1080 (`layout-and-style.md`) and scaled with one
  unit, `--u`, so the slide looks the same on any screen and on paper.

## Template

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Onboarding review</title>
<style>
  :root {
    /* Set these from the host theme tokens or the user's brand. Fallbacks = neutral default. */
    --deck-bg: #ffffff; --deck-text: #1a1a1a; --deck-muted: #6b6b6b;
    --deck-line: #d4d4d4; --deck-accent: #2563eb; --deck-font: system-ui, sans-serif;
    /* One design pixel of a 1920x1080 slide, fitted to the window. */
    --u: calc(min(100vw, 100vh * 16 / 9) / 1920);
  }
  * { box-sizing: border-box; }
  html { scroll-snap-type: y mandatory; }
  body { margin: 0; background: #111; font-family: var(--deck-font); }
  .slide {
    position: relative; overflow: hidden; scroll-snap-align: center;
    width: calc(1920 * var(--u)); height: calc(1080 * var(--u));
    margin: 0 auto calc(16 * var(--u));
    padding: calc(80 * var(--u)) calc(96 * var(--u)) calc(64 * var(--u));
    background: var(--deck-bg); color: var(--deck-text);
    font-size: calc(40 * var(--u)); line-height: 1.35;
  }
  .slide h1, .slide h2 { margin: 0 0 calc(48 * var(--u)); line-height: 1.15; max-width: calc(1500 * var(--u)); }
  .slide h1 { font-size: calc(104 * var(--u)); }
  .slide h2 { font-size: calc(72 * var(--u)); }
  .kicker { margin: 0 0 calc(16 * var(--u)); font-size: calc(28 * var(--u)); color: var(--deck-muted);
    text-transform: uppercase; letter-spacing: .06em; }
  .grid { display: grid; grid-template-columns: repeat(12, 1fr); column-gap: calc(24 * var(--u)); }
  .span-4 { grid-column: span 4; } .span-6 { grid-column: span 6; }
  .span-8 { grid-column: span 8; } .span-12 { grid-column: span 12; }
  .big-number { font-size: calc(200 * var(--u)); font-weight: 700; line-height: 1; color: var(--deck-accent); }
  .accent { color: var(--deck-accent); }
  .slide figure { margin: 0; }
  .slide img { display: block; max-width: 100%; height: auto; }
  .source, .slide-number { position: absolute; bottom: calc(24 * var(--u)); margin: 0;
    font-size: calc(22 * var(--u)); color: var(--deck-muted); }
  .source { left: calc(96 * var(--u)); }
  .slide-number { right: calc(96 * var(--u)); }
  .notes { display: none; }
  /* Speaker copy: add class="show-notes" to <body>; slides grow to fit their notes. */
  body.show-notes .slide { height: auto; min-height: calc(1080 * var(--u)); padding-bottom: calc(112 * var(--u)); }
  body.show-notes .notes { display: block; margin-top: calc(48 * var(--u)); padding-top: calc(24 * var(--u));
    border-top: 1px solid var(--deck-line); font-size: calc(28 * var(--u)); color: var(--deck-muted); }
  @page { size: 13.333in 7.5in; margin: 0; }
  @media print {
    :root { --u: calc(13.333in / 1920); }
    html { scroll-snap-type: none; }
    body { background: none; }
    .slide { margin: 0; break-after: page; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<main>
  <section class="slide" aria-labelledby="s1">
    <h1 id="s1">Onboarding v2 cut churn by a third</h1>
    <p>Product review · Ana Silva · 3 Nov 2026</p>
    <aside class="notes">One-line point of the talk, then what you'll cover.</aside>
  </section>

  <section class="slide" aria-labelledby="s2">
    <hgroup>
      <p class="kicker">Retention</p>
      <h2 id="s2">Churn fell by a third after the new onboarding shipped</h2>
    </hgroup>
    <div class="grid">
      <figure class="span-8">
        <img src="churn.png" alt="Line chart: churn fell from 8.1% to 5.4% after the March launch.">
      </figure>
      <p class="span-4">The biggest drop came in a customer's <strong class="accent">first 30 days</strong>.</p>
    </div>
    <p class="source">Source: billing data, Jan–Dec 2026</p>
    <p class="slide-number">2</p>
    <aside class="notes">The point: onboarding fixed early churn. Look at March...</aside>
  </section>

  <section class="slide" aria-labelledby="s3">
    <h2 id="s3">Roll the new onboarding out to every plan by January</h2>
    <p>Ask: approve two engineers for six weeks.</p>
    <p>Questions: ana@example.com</p>
    <aside class="notes">Restate the ask, then take questions with this slide up.</aside>
  </section>
</main>
</body>
</html>
```

Adapt, don't copy blindly: change the variables, keep the unit, add slide types from
`layout-and-style.md` as needed.

## Brand and theme

- If the host has a theme, read its colour and font tokens and set the `--deck-*` variables from
  them, for example `--deck-accent: var(--theme-accent, #2563eb)` with the host's real token name. Don't hard-code colours
  the theme already defines.
- With a user brand, use its hex codes and fonts. Load web fonts only from sources the host allows.
- Check contrast after mapping. Theme colours made for a website can fail on a projector.

## Charts and images

- Use the host's chart tool or plugin if it has one, or an image of the chart. Simple bars can be
  inline SVG with `role="img"` and an `aria-label` that states the point.
- Every chart needs a text alternative: alt text or a short caption with the key numbers.
- Upload images through the host's media tools when it has them, and reference the stored URL.

## Host limits

- Some page tools accept only body content, strip `<style>` or `<script>`, or rewrite markup.
  Keep the same structure and put the CSS where the host allows: a style block, theme custom CSS,
  or inline styles. Then check a screenshot.
- Ask before replacing an existing page. Publish as a draft or unlisted page if the host can.

## Presenting and exporting

- Present: open the page, go full screen (F11, or the browser's full-screen command), and use the
  arrow or Page Down keys.
- PDF: print, choose "Save as PDF". The `@page` rule gives one 16:9 page per slide. Turn on
  background graphics if the browser asks.
- Speaker copy: add `class="show-notes"` to `<body>` and print, or list the notes in chat.
- PowerPoint, Keynote or Google Slides: out of scope here. Hand over the slide specs, or use a
  host export tool if one exists.

## Checks

- Screenshot each slide at a 1920×1080 viewport. Text must not run past the margins; overflow is
  hidden, so look.
- Print preview shows one slide per page, nothing cut off.
- Contrast passes; every image has alt text; headings are unique and in order.
- The page still makes sense with CSS off: headings, then content, in speaking order.
