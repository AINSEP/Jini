# Job open-fixes (owner-approved 11-06): known small bugs and known failing tests
Base in both repos: origin/cloud/combine (Tovu 74fedc132, Jini f07ae3d6f), which already holds every merged job and the UI fixes. Create cloud/<job> from it in each repo you change. Owner approved --no-verify for that branch in Tovu. Hard cap 2 hours. Your prompt may add items that are not listed here; they count the same. General wording in commits and reports: these repos are public. List every bug you notice under "Bugs found", fixed or not.

Check each item first. If one is wrong or already fixed, say so and leave it. Failing test first for real bugs. Never weaken a test.
1. /commerce/return/ in capitals (/COMMERCE/RETURN) falls through to the CMS instead of the return handler.
2. A site name containing $& garbles the title of externalStopConfirm: a string replacement treats it as a pattern. Check for the same mistake in the other prompts built the same way.
3. 'L3 isolated guard: secret-sentinel' fails because the pending warning omits media/ (cloud/reports/small-fixes.md:128).
4. Known failing tests: site-exporter (5), site-cookie-consent.test.ts:101, site-consent.test.ts:166, settlement (3). Say for each whether the code or the test is wrong. Consent has had two fix rounds: if a consent failure needs a new mechanism, stop on it and report.
5. The 76 test-only type errors listed in cloud/reports/full-tests.md. Real types, no any, no ts-ignore.
6. tovu-starter render/pages/*.html differ between content/themes/static and content/themes/__original-themes__/static. Find out which is right and why they drifted, then make the smallest correction so Reset and a new site give the same pages. Do not change the look.
7. Cloudflare and Vercel plugin manifest versions stayed the same while their payloads changed. Find out whether plugin updates key on the version. If they do, fix it with the smallest change and say what a site would have missed.

Report at cloud/reports/open-fixes.md and in your final message: shas, each item fixed, wrong or stopped and why, tests with exact commands.
