# merge-rest — in progress

Branch: cloud/combine. Starting SHA: 3a86f98ba03380651c8bf64b8fc18c4f90a122fd.

Scope: merge security-release, om-chat-2, tag-b, passkeys, commerce in order; restore the lost Tovu model inventory metadata wiring. Push only cloud/combine. No version bumps, publish, deploy, or full suites.

Loaded COMMON.md, merge-rest.md, AI Dev Shop AGENTS.md and software-architect/programmer/tdd skills.md from origin/cloud-plans-1105.

Setup in progress: rebuild Jini on cloud/combine and relink Tovu. Existing package-store cache is read-only; copying the non-secret dependency cache to workspace and installing there. Checks and merge outcomes pending.

FINDING: pre-existing untracked Jini packages/plugin-ui-ux-design leftovers are untouched.

## Merge checkpoint — in progress

All requested source tips included in order. Jini security-release was already an ancestor; all other source branches have real merge commits. No branch omitted.

Conflict: packages/agent-plugins/package.json. Preserved all formspree/software-engineering and commerce entries, exports, optional peers and peer metadata. Lockfile merged automatically; frozen install pending.

Starting Jini recursive build PASS after frozen install into workspace-local store. Tovu contracts and SDK builds, link:jini and both original inventory test commands PASS. Metadata restoration and post-merge verification pending.

First-parent commits so far:

```text
99c215f86acd6fbe93f8c0ccd2ed33a664f8cf0a Merge commerce updates into cloud/combine
9ee87e7917a0a0077e0780fd2f5b453f82e81985 Merge identity updates into cloud/combine
5f7256b1ba742f44a4cd1c3db7396f37e221b390 Merge shared control updates into cloud/combine
2a4c4bed9a3b0bb0ebbef200539ae3a589bfe019 Merge chat updates into cloud/combine
a3516383e638b0d6bf8e0649e732590273444649 docs: record integration scope and starting points
```
