# Theme extraction: what site-import hands to the theme plugin

Version: 2.1.0 (2026-11-02)

The theme step belongs to the host's theme plugin: the installed plugin that provides
`theme-authoring` (find it with the host's plugin search when its name is not known). Load it and
follow its "match a reference site" procedure to the end, including its screenshot compare loop:
one place owns design logic. If no plugin provides `theme-authoring`, say so in the report and
leave the look unchanged; never edit theme files without it.

Why the hand-off (an import on 2026-10-08): the old recipe here duplicated the active starter
theme and edited only tokens and the nav/footer partials. The starter's header, 720px page
column and fonts won, the run never screenshotted its own page, and the result looked like the
starter in a different colour. The theme plugin's procedure rebuilds layout, header, page shell
and fonts, and requires a screenshot compare loop.

## What to hand over

Pass these in the same turn, so the theme procedure does not re-read what Steps 1-2 already fetched:

- The source homepage URL, and the stylesheet URLs from its `stylesheets` field.
- Palette, fonts and logo you already noted (roles and values, as the source wrote them).
- The main menu's id from Step 4 (the menu create result returns it): the theme procedure puts
  it in the header's menu placement.
- The footer menus' slugs and column headings (content-mapping.md § 9): the theme procedure renders each
  one through the host's menu placement in the footer instead of hard-coding its links.
- The header call-to-action: label and href exactly as on the source.

## Still site-import's job

- Favicons: a binary `.ico`/`.png` cannot be written into a theme by any tool. Name it in the
  report with its source URL.
- Content images: the media library (content-mapping.md § 3), not the theme.
- Page HTML that keeps a source's scroll-reveal start state (content-mapping.md § 5).
