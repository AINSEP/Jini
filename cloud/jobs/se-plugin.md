# Job se-plugin (owner-approved 11-06): rebuild Tovu Software Engineering from the latest AI-Dev-Shop
Base in both repos: origin/cloud/combine (Tovu 74fedc132, Jini f07ae3d6f), which already holds every merged job and the UI fixes. Create cloud/<job> from it in each repo you change. Owner approved --no-verify for that branch in Tovu. Hard cap 2 hours. General wording in commits and reports: these repos are public. List every bug you notice under "Bugs found", fixed or not. Commerce is on hold: do not change commerce code unless an item below names it.

Owner: update from the latest AI-Dev-Shop; this plugin mainly serves the vibe coding module and will be updated often.
1. git clone --depth 1 https://github.com/leonaburime-ucla/AI-Dev-Shop /workspace/work/ai-dev-shop-latest and record its sha. If that fails, stop and report it. Push nothing to AI-Dev-Shop.
2. Update the existing plugin Jini packages/agent-plugins/software-engineering from that copy (subpath software-engineering, display name "Tovu Software Engineering"; do not make a second plugin). Carry over what helps someone building or fixing a web app in a coding agent: implementation, architecture, debugging, testing, code review, security. Keep it routed so only what is needed loads. Keep LICENSE and NOTICE correct.
3. Add no project specifics, session names or provenance inside skill text the agent reads. Tovu-only rules go in an overlay, as content/agent-plugin-overlays/ui-ux-design/GUIDANCE.md does for ui-ux-design.
4. Make updating repeatable: one small script or documented command that re-syncs from a given AI-Dev-Shop sha, with the sha recorded in the package README. No new framework.
5. Check how the vibe coding module would reach this plugin, and say what is missing. Do not build vibe coding features. Also say whether the ui-ux-design plugin is behind the same sha, without changing it.
6. Run the plugin's own tests and the bundled-package checks.

Report at cloud/reports/se-plugin.md and in your final message: shas, the AI-Dev-Shop sha, what came over and what was left out and why, the update command, tests with exact commands.
