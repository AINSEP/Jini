# Job security-release
Prepare a small security release on top of the current test branches. Owner approved.
Branches: Jini `cloud/security-release` from origin/integ/night-1105 merged with origin/cloud/tag-a; Tovu `cloud/security-release` from origin/night-1105 merged with origin/cloud/tag-a and origin/cloud/tovu-deps. Don't merge any other cloud job. Stop and report if tag-a's report still says in progress.
Do:
1. Resolve merges with the smallest change. Rebuild Jini, relink Tovu.
2. Run the tests touched by those branches, tsc on Jini + root + desktop, and complexity lint. Fix real failures honestly. Include the MessageRow AssistantMessageRow complexity 15: split it with no behaviour change.
3. Bump changed Jini packages to 0.6.23 with CHANGELOG lines kept general ("security hardening"), following commit 651571c5f's shape, and bump plugin-catalog and provider-plugins too: the catalog's digests must match. Set Tovu floors to the versions you bumped; lockfile refresh waits for publish.
4. Build every Jini package, run guard:plugins and guard:plugins:packed.
5. Secrets scan the range. Report commits, tests, and the exact list of packages to publish.
Do NOT npm publish, tag, deploy, or push main: the coordinator publishes from the final commit. Keep commit messages and reports general; no exploit details, file:line or reproduction steps for security fixes.
