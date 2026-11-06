# Job fix-round (owner-approved 11-06): review findings and listed leftovers
Base in both repos: origin/cloud/combine (Tovu c11d491f3, Jini f4e3b18a5). Create cloud/fix-round from it in each repo you change. Owner approved --no-verify for that branch in Tovu. Hard cap 2 hours. General wording in commits and reports: these repos are public. Commerce and vibe coding are on hold. List every bug you notice under "Bugs found".

Check each item first. If one is wrong or already fixed, say so and leave it. Failing test first for real bugs. Never weaken a test, and when a test is out of date say why. Smallest change.

Desktop:
1. Renderer test loader recurses: apps/desktop/scripts/one-react.ts:20 calls fromHere.resolve() inside its registered resolver; on Node 24 the normal renderer test command overflows the stack. Resolve targets before registering the hook.
2. A tab's "Keep running" choice closes the tab without holding idle sleep, so the site stops after 10 idle minutes (use-tab-close-ask.hooks.ts:81, use-project-tabs.hooks.ts:46, project-ipc.ts:1667). The last-window choice calls keepAwake(). Make the tab choice hold it too. State what releases the hold, and the memory and process cost.
3. Overlapping tab closes lose a request (use-tab-close-ask.hooks.ts:78, :98): stopping A, asking to close B, then A finishing clears B's prompt unanswered.

Assistant and connections:
4. Empty connection arguments are lost on an unchanged save: features/external-mcp/save-form.ts:84 turns ["", "--name=x"] into " --name=x", which reparses as ["--name=x"].
5. Mail plugin-disable cleanup reads lanes then writes with no revision guard, so it can overwrite a simultaneous provider selection.
6. Custom-domain static publish appears to ask twice: run it for real in a test, and if so make it one card.
7. Google Workspace admin status and list actions omit effects and inherit write approval. Declare the read-only ones honestly.
8. Unchecked confirmation choices use a plain-object ID map and mishandle the ID __proto__.
9. Project-key mail credential save returns HTTP 500 instead of 200 on the attached-only vault refusal.

Tests, types, cleanup:
10. 6 Jini confirmation exact-output hash tests disagree with the base. Find which commit changed the output and whether the change was meant.
11. Failing on the base: OAuth reauthorization status case (external-mcp-oauth.test.ts); boot-owner refusal fixture (dev-auth-failures.unit.test.ts); daemon refusal fixture (assistant-daemon-connection.test.ts); SiteExportTab.static.unit.test.tsx "shows static-export scope notes".
12. Observability fixture omits a temporary site binding and can write its marker at the default site path. Fix the fixture.
13. Complexity: the unchanged source helper at 11 named in cloud/reports/open-fixes.md, and the form-file-maintenance test at cognitive 11. Split them; no debt-list entry.
14. Remove the obsolete admin card selectors at apps/admin/src/styles.css:6237 once you have confirmed nothing uses them. Also the stale dashed-bubble text in Jini chat styles.ts.
15. Semgrep misses the form `return await promise.catch(error => { throw new Error(error.message); })`. Add it if the engine allows, otherwise say why not. The 3 super-linear-regex warnings in coverage classifiers: fix them if the fix is plain.
16. Provider chart dependencies are missing in a clean cloud build (cloud/reports/banner-b.md). Find out why provider-plugins does not build from a clean install and fix it in the manifests.

Report at cloud/reports/fix-round.md and in your final message: shas, each item fixed, wrong or stopped and why, tests with exact commands.
