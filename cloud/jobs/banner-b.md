# Job banner-b (owner decision 11-06): consent on static themes, by one loader tag from the server
Base in both repos: origin/cloud/combine (Tovu 74fedc132, Jini f07ae3d6f), which already holds every merged job and the UI fixes. Create cloud/<job> from it in each repo you change. Owner approved --no-verify for that branch in Tovu. Hard cap 2 hours. General wording in commits and reports: these repos are public. List every bug you notice under "Bugs found", fixed or not. Commerce is on hold: do not change commerce code unless an item below names it.

Owner chose this over tags in theme files. Owner's words: "I don't want the engine rewriting the page and stripping the scripts out", and the consent cookie "should not touch any other page". So no scanning, no parsing, no stripping, and when consent is off a static page gets nothing extra.

1. When consent is on, the server adds one loader tag to static-tier pages at the existing finishing points (pages.ts finishStaticTierDocument and the static home page path in http/site/render.ts, plus any other static-tier path), loading the same client and the existing context route. Static export gets the same tag if consent is on, and it must work under a subpath.
2. Remove what this replaces: the tag from the 21 static theme files, the theme-skill teaching, and the slot check. Existing sites, Reset copies and subpath exports then work with no upgrade. A theme file that still has the old tag must not load the client twice.
3. Loader route: a read failure gets handling and plain words, not a crash.
4. Failing test first through real static themes (tovu-theme, tovu-starter), for consent on and off, and for an old copy that still has the tag.
5. Expect fewer lines than now. Consent has had two fix rounds: if this needs a new mechanism, stop and report.

Report at cloud/reports/banner-b.md and in your final message: shas, lines added and removed in production code separately from tests, tests with exact commands.
