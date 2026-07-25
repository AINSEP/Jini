---
name: honest-testing
description: Guard rails for writing tests and raising coverage without cheating. Use whenever the task involves adding tests, chasing a coverage number, fixing a failing test, or reviewing someone else's test diff. Triggers on "get to 100%", "coverage", "add tests", "why is this test failing", "test:coverage", "close the coverage gap", or any request that makes a metric go up rather than making the code more correct.
---

# Honest testing

A coverage number is a proxy. The moment you optimize the proxy instead of the thing it stands
for, the number stops meaning anything — and worse, it now *actively lies* to whoever reads it
later, because green is supposed to mean safe.

This skill exists because every cheap way to raise coverage is also a way to destroy its value,
and most of them look like tidying up in a diff.

## The rule

**Coverage goes up because more behavior is verified. Never because less code is measured, less
is asserted, or less is done.**

If you cannot honestly raise it, report the real number with an explanation. An honest 99.7% with
one paragraph on what is left beats a 100% that someone has to discover was fake.

## Banned moves

Do not do any of these to make a number move. Each is silent in a diff and each destroys signal.

| Move | Why it is banned |
|---|---|
| Deleting or weakening a branch so there is less to cover | The branch existed for a reason; you removed a behavior, not a gap |
| `/* c8 ignore */`, `/* istanbul ignore */`, `@vitest-environment` tricks | Hides the gap instead of closing it |
| Adding files to the coverage `exclude` list | Same, at file scale — and it silently exempts everything added to that file later |
| Lowering a threshold to match the current number | Inverts the gate: it now measures nothing |
| Deleting, `.skip`-ing, or `it.only`-ing a failing test | The failing test was the only thing telling you something is wrong |
| Loosening an assertion (`toBe` → `toBeDefined`, exact value → `expect.any`) | The test still runs, still passes, and now verifies nothing |
| Wrapping a failing assertion in `try/catch` or a conditional | Same |
| Removing a field, guard, or option so the code is simpler to test | You cut product capability to serve a metric. Never |
| Writing a test whose only purpose is to execute a line | Worse than the gap: it reads like verification and is not |

Two things that look like the above but are legitimate, if and only if you can state why:

- **A genuinely unreachable branch gets refactored away, not fake-tested.** If upstream validation
  already guarantees a condition, delete the dead check and leave a comment naming what guarantees
  it. This makes the code smaller *and* more honest. If you are not certain it is unreachable, it
  is not — leave it and report it.
- **A file with zero executable statements** (types and interfaces only) reports 0% as an artifact.
  Prefer leaving it in `include` so a future runtime addition is still gated. Only ever exclude it
  with an explicit comment, and never as a batch.

## What to do instead

1. **Read the uncovered lines before writing anything.** Use `coverage-final.json` /
   `coverage-summary.json`, not the terminal table — the text reporter truncates rows once there
   are many files, so you will confidently "fix" the wrong file.
2. **Ask what each uncovered branch is for.** Most survivors are error paths, race guards
   (`if (!mounted || generation !== current) return`), and fallbacks. Those are exactly the paths
   that break in production and never get exercised by hand.
3. **Reach it properly.** Race guards need controlled promise resolution. Host APIs need a fake
   (a plain object satisfying the interface), not a disabled code path. Missing browser APIs get a
   minimal stand-in — mock the wrapper, keep the real data types where they exist.
4. **Name the test after the behavior**, and where a test encodes a past bug, say so in a comment.
   `it('refuses to fill a password field even when it carries a valid handle')` tells the next
   reader what is protected. `it('covers line 63')` tells them nothing.
5. **Prefer extracting over cutting.** If a thing is hard to test because it is tangled with a
   framework or the DOM, pull the decision into a pure function and test that. The
   policy-in-core / mechanism-in-host split exists for exactly this reason.

## Before claiming a number

- Run it. Paste the real output. Never state a coverage figure you did not just measure.
- Read the number from the JSON summary, not the truncated table.
- Confirm the whole suite still passes — coverage that went up while a test broke is not progress.
- If the run exits non-zero, say so and say why, even when the percentages look good.
- State what is still uncovered and why. "100%" with an unexplained exclusion list is not 100%.

## Reviewing a coverage diff

When checking someone else's work — including a subagent's — the number is the least informative
part. Look for:

- Threshold or `exclude` changes in `vitest.config.ts` / `jest.config` / `.nycrc`
- New `ignore` comments of any flavor
- Deleted or skipped tests — compare the **total test count** before and after, not just the pass rate
- Assertions that got vaguer, especially `toBeDefined`, `toBeTruthy`, `expect.any`
- Source changes inside a "test-only" diff — a removed branch is the classic
- Tests with no meaningful name, or several tests asserting the same trivial thing
- A suspiciously round jump in one commit

Ask directly: *which behaviors are verified now that were not before?* If that question has no
concrete answer, the number moved for the wrong reason.

## Delegating test work

Subagents optimize what you measure them on. If you ask for "100%", that is what you will get,
by whatever route. Always include:

- The banned moves above, explicitly
- "An honest 99.7% with an explanation beats a 100% reached by gutting a branch"
- A requirement to report every branch they refactored away, with the reason
- A requirement to report the before/after **test count**, so deletions cannot hide

Then verify the diff yourself against the review list. Do not take the reported number at face
value — not because the agent is dishonest, but because "make this number 100" is an instruction
with an easy wrong answer.
