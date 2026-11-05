# Testing Mistakes Catalog

Tests that pass while the behaviour they are named for is broken.

Each entry has the same shape, in this order:

- **Contract:** the observable behaviour the test must protect.
- **How to spot it:** what the mistake looks like when reading a test.
- **Code under test**, with exactly one bug marked `// BUG:`.
- A **bad test** that stays green while that bug ships.
- **Bug it lets through**, in user terms.
- A **correct test** that fails on that bug, and **Fails because**: why it
  goes red, and what is safe to fake versus what must stay real.
- **Verify:** the bad test passes on the buggy code; the correct test fails
  on it and passes after the fix.
- The **rule** to carry forward.
- **When it doesn't apply:** the cases where the rule is not needed.

Some entries also list **other forms** of the same mistake, and the **audit
labels** that map to the entry.

Load this file when you **write, fix, or review tests**. It is not limited to
aggregate-risk workflows; the rest of `adversarial-test-design` is.

Examples use TypeScript with Vitest, Testing Library, and Playwright
(plus one Python example). The failure types apply to every language and
runner.

**Example conventions.** Each JS/TS test block stands alone as one test file:

- It imports what it uses from `vitest` (`describe`, `it`, `expect`, `vi`,
  hooks), `@testing-library/react` and `@testing-library/user-event`.
- A block that needs a DOM starts with `// @vitest-environment jsdom`.
- TSX examples assume the automatic JSX runtime (React 17+ with
  `jsx: react-jsx`, or the Vite/Vitest defaults), so no `React` import is
  needed.
- Assertions use plain DOM checks (`document.activeElement`, `textContent`,
  `not.toBeNull()`), not jest-dom matchers such as `toHaveFocus` or
  `toHaveTextContent`. To use those matchers, import
  `@testing-library/jest-dom/vitest` explicitly.
- The symbols of the code under test are imported from the module shown in
  its block; those import lines are left out, in the Python example too.

## The One Question

Ask this of every test you write or review:

> **If the behaviour this test is named for broke in a realistic way, would
> this test fail?**

To answer it, name the concrete change that breaks the behaviour and check
the test against it. Once the code exists, that is a one-line source edit:
apply it and confirm the test goes red. Before the code exists, name a
concrete hypothetical faulty implementation instead (Author Checklist item 1).
If you cannot name one, you have not checked the test yet.

## What I'm About to Test → Entries

Find the row for what you are about to test, then check the listed entries
before you finish. Every entry appears in at least one row.

| What I'm about to test | Entries to check |
|---|---|
| A hook or component with async loading | F1.4, F2.3, F2.4, F5.1, F6.2, F6.5, F7.1 |
| A UI interaction (keyboard, focus, click) | F1.3, F2.1, F2.2, F2.5, F3.1, F6.1 |
| An adapter, port or HTTP client | F1.1, F2.5, F2.6, F3.6 |
| A persistence write (create/update/delete) | F1.2, F2.1, F4.5, F5.4, F6.3, F6.4 |
| An API route or handler | F2.4, F3.1, F4.1, F4.4, F4.6, F6.3 |
| A CLI command | F2.4, F2.5, F3.1, F3.5, F4.6, F5.1, F7.2 |
| A DB query or migration | F1.3, F1.5, F1.6, F2.6, F4.4, F5.1 |
| An event bus, listener, subscription or registry | F1.4, F1.6, F2.3, F3.2, F3.3, F3.5 |
| A parser or validator | F1.2, F4.3, F4.4, F5.2, F5.5, F7.3 |
| A config or default value | F1.5, F4.3, F6.4, F7.2, F7.5 |
| Styling or layout | F1.5, F2.4 |
| Timers, retries or concurrency | F5.3, F6.2, F7.1, F7.4, F7.7 |
| A completeness or "must not contain" check (i18n keys, routes, registries, banned text) | F4.2, F5.2, F5.6, F7.3 |
| A store, cache or other stateful unit | F6.4, F6.5, F7.5 |
| Writing fakes and mocks for any test | F2.2, F2.6, F3.2, F3.3, F3.4, F3.6, F7.6 |
| Shared setup, hooks, snapshots or runner config | F4.6, F7.3, F7.4, F7.5, F7.6 |

## Worked Incident: The Find Bar That Took One Letter

A desktop find bar lost focus after every keystroke, so the user could type
only one letter. The fix shipped with every test green, and the bug was still
there.

| What the tests did | Entry | Why it proved nothing |
|---|---|---|
| Unit tests asserted `input.focus()` was **called** | F2.1 | `focus()` silently does nothing when the browser already thinks the input is focused |
| The E2E check typed with Playwright `keyboard.type` | F3.1 | It delivers keys straight to the page and skips the OS/browser key routing, which is where the bug lived |
| Only pure helper predicates were tested | F2.3 | The real effect bodies (refocus loop, IME guard, "result arrived → restore focus") ran in no test |

Lesson: assert the user-visible outcome through the real mechanism. A test
that only proves "our code did something" proves nothing.

## Using This Catalog

**When writing a test:** check the entries the index above lists for what
you are testing, then run the Author Checklist below before you finish.

**When reviewing a test:** follow the Review Protocol. Cite findings by entry
ID (for example `F3.3`).

### Family Index

Each entry's first line (in italics) says how to tell it apart from its
neighbours.

| ID | Family | Entries |
|---|---|---|
| F1 | Checks something, but not the thing that matters | 1 loose match · 2 presence, count or shape instead of value · 3 count or content instead of ownership · 4 source-text wiring · 5 CSS text instead of layout · 6 selected by position instead of identity |
| F2 | Called, not worked | 1 call instead of effect · 2 spy on the wrong receiver · 3 effect bodies no test runs · 4 connection between units never proven · 5 contract call without arguments · 6 real implementation behind a fake never runs |
| F3 | Fake world | 1 synthetic input · 2 fake fires events the real source would not · 3 fake keeps less state than the real thing · 4 unit under test is mocked · 5 synthetic lifecycle · 6 fake accepts any request |
| F4 | The test proves itself | 1 expected value from the code under test · 2 completeness check against a hand-kept list · 3 input that does not decide the result · 4 one guard masking another · 5 end state already true before the action · 6 expected value is the bug |
| F5 | Never actually checks | 1 assertion that may never run · 2 vacuous check · 3 log text instead of state · 4 evidence destroyed before the assertion · 5 assertion failure swallowed · 6 the test's own scanner cannot see what it checks |
| F6 | Tests the wrong or missing thing | 1 name promises more than the body checks · 2 the branch that matters has no test · 3 stops at the response · 4 persisted but not active · 5 internal state instead of observable behaviour |
| F7 | Passes or fails by luck | 1 timing and concurrency not controlled · 2 machine or environment dependent · 3 relies on a check that never runs · 4 retry until green · 5 state shared between tests · 6 leaked spies, mocks or globals · 7 unpinned clock or random source |

## Author Checklist

Run this on every new or changed test before handing it off. Apply each
item subject to the "When it doesn't apply" of the entries it cites.

1. **One Question.** Name the change that should make this test fail. Before
   the code exists, name a concrete hypothetical faulty implementation the
   test must reject. Once the code exists, name an executable one-line source
   mutation, apply it, and check the test goes red. For acceptance-criterion
   tests, write it down.
2. **Missing cases (F6.2).** For each of these the unit actually has, is
   there a test?
   - the error path
   - a second call
   - a retry after a failure
   - a change to the inputs while work is in flight
   - a timeout
3. **Title matches body (F6.1).** Every behaviour named in the title is
   exercised and asserted.
4. **Effect, not call (F2.1, F2.5).** A spy assertion is used only where the
   call itself is the contract, and then with exact arguments.
5. **Real code runs (F2.3, F2.6, F3.4).**
   - Every effect, listener and adapter in scope is executed by some test.
   - Nothing the test makes claims about is mocked.
6. **Fakes are strict (F3.2, F3.3, F3.6).** Fakes fire only for what was
   registered, keep every registration, and reject wrong requests.
7. **Independent expectations (F4.1, F4.6).** Expected values come from the
   spec or a literal. They never come from the code under test or from its
   current output.
8. **Distinguishing fixtures (F4.3, F4.4, F4.5).**
   - Fixture values are non-default.
   - Only the guard under test can fail the case.
   - The starting state differs from the expected end state.
9. **Unconditional assertions (F5.1, F5.2, F5.5).**
   - Membership is checked before order or absence.
   - No `catch` can turn an assertion failure into a pass.
10. **Read back (F6.3, F6.4).** Mutations are verified through an independent
    read of the state the app actually uses, including any in-memory copy it
    serves from.
11. **Observable output (F1.6, F6.5).** Assertions go through the interface a
    caller uses and select items by key, not by position or private state.
12. **Isolated and pinned (F7.4–F7.7).**
    - No retries that discard a genuine failure. Controlled polling for an
      explicit signal, with a deadline, is fine.
    - Each test builds its own state and restores every spy, stub, global and
      timer it replaced.
    - The clock and random sources are pinned where the unit reads them.

## Review Protocol

Without these rules, reviewers miss the real gaps or flag behaviour that is
already covered.

1. **Execution inventory first.** A test file is "clean" only after you list
   the source functions, effects, callbacks, listeners and adapters its tests
   never execute, each with a reason. An empty list must be earned.
2. **Check siblings before flagging.** A weak assertion is not a finding if a
   sibling test covers the same behaviour properly. Name the siblings you
   checked.
3. **Source-text tests must pin the location.** If a test scans source text, it
   must pin *where* the code sits (which element, which branch, which call
   site), not that the text exists somewhere in the file.
4. **Mock-call assertions are sometimes the contract.** Asserting exact
   arguments to a callback prop, a port adapter, or an event bus is valid when
   delivery is the promise and a sibling test covers the downstream result.
   Flag it only when the test's name promises an outcome that the call alone
   cannot prove.
5. **Report the mutation and the fix together.** Each finding states:
   - the one-line edit that survives;
   - which entry it matches;
   - the smallest test change that would kill it.

---

## F1 — Checks something, but not the thing that matters

### F1.1 — Loose match: a permissive matcher or property accepts wrong output

*The assertion reads the right value, but its oracle (a substring, a regex, a
set of accepted states, or a property such as "deterministic") also accepts
realistic wrong values. (If the assertion never reads the value at all, only
its presence, type or count, see F1.2.)*

**Contract:** creating a widget sends one POST to exactly
`/api/sites/<siteId>/widgets` with the given body.

**How to spot it:** the assertion uses `toContain`, `toMatch`, `startsWith`
or an unanchored regex on a value whose exact form is known.

**Code under test**
```ts
type Http = { post(url: string, body: unknown): Promise<unknown> };

export const widgetUrl = (siteId: string) =>
  `/api/sites/${siteId}/widgets/widgets`;          // BUG: segment doubled
export const createWidget = (http: Http, siteId: string, body: { kind: string }) =>
  http.post(widgetUrl(siteId), body);
```

**Bad test**
```ts
import { it, expect, vi } from 'vitest';

it('creates the widget on the current site', async () => {
  const http = { post: vi.fn(async (_url: string, _body: unknown) => ({})) };
  await createWidget(http, 's1', { kind: 'chart' });
  expect(http.post.mock.calls[0][0]).toContain('/widgets');
});
```

**Bug it lets through:** every widget create gets a 404. The doubled path
still contains `/widgets`.

**Correct test**
```ts
import { it, expect, vi } from 'vitest';

it('creates the widget on the current site', async () => {
  const http = { post: vi.fn(async (_url: string, _body: unknown) => ({})) };
  await createWidget(http, 's1', { kind: 'chart' });
  expect(http.post).toHaveBeenCalledTimes(1);
  expect(http.post).toHaveBeenCalledWith('/api/sites/s1/widgets', { kind: 'chart' });
});
```
**Fails because:** the buggy call is `post('/api/sites/s1/widgets/widgets', …)`,
which is not equal to the literal path. The count check pins the "one POST"
half of the contract. The HTTP client is safe to fake here
because the URL it receives is the whole contract. Only `widgetUrl` and
`createWidget` must stay real.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** assert the exact value. A matcher must reject the wrong outputs a
realistic bug would produce.

**When it doesn't apply:** not applicable when the contract really is
containment (a required keyword in free-form text, one line in a long log),
because then the loose match is the exact contract.

**Other forms:**
- `/about` matches `/about.html`.
- An English fallback string passes a translation test.
- The test checks only properties of a format string (it's deterministic, it
  differs when the input differs) and never pins the exact string, so
  reordering its segments passes, and data written in the old format no
  longer opens.
- A settlement check accepts `errored` as readily as `completed`, so a job
  that always fails passes the "succeeds" test.
- A request-count check uses `>= 1`, so duplicate or unrelated requests pass.

**Audit labels:** LOOSE-MATCH, NO-FORMAT-PIN, STATUS-NOT-OUTCOME, WEAK-ASSERT

### F1.2 — Presence or shape instead of value

*The assertion checks that something exists, how many there are, or what
type or kind it is, never what it contains. (If the content is right but
attached to the wrong entity, see F1.3.)*

**Contract:** the serialized document contains exactly the content of the
document that was saved.

**How to spot it:** the assertions are `toBeDefined`, truthiness,
`length > 0`, `toHaveLength`, `typeof`, or a `type`/`kind` field, and none of
them reads the payload.

**Code under test**
```ts
type Doc = { version: number; content: unknown[] };

export function serialize(doc: Doc) {
  return { version: doc.version + 1, bodyJson: { type: 'doc', content: [] } };  // BUG: drops doc.content
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';

it('serializes the document', () => {
  const doc = { version: 1, content: [{ type: 'text', text: 'Hello' }] };
  const out = serialize(doc);
  expect(out.bodyJson).toBeDefined();
  expect(out.bodyJson.type).toBe('doc');
});
```

**Bug it lets through:** every save wipes the document's content.

**Correct test**
```ts
import { it, expect } from 'vitest';

it('serializes the document', () => {
  const doc = { version: 1, content: [{ type: 'text', text: 'Hello' }] };
  expect(serialize(doc).bodyJson).toEqual({
    type: 'doc',
    content: [{ type: 'text', text: 'Hello' }],
  });
});
```
**Fails because:** the buggy output has `content: []`, which does not equal
the one-node literal. The fixture must have non-empty content; with an empty
document the bug is invisible. Nothing is faked.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** `toBeDefined`, truthiness, `length > 0`, `typeof` and "is a
function" checks only prove that *something* came back. Assert its value.

**When it doesn't apply:** not applicable to the value itself when any value
is valid by contract (an opaque generated handle), because no literal could be
written for it; pair presence with a uniqueness or format check. If the handle
must resolve to a specific stored entity, still look it up and assert that it
returns that entity, because presence, format and uniqueness cannot show it.

**Other forms:**
- Any string passes as an ID.
- The event kind is checked but not its payload.
- ID and metadata fields are checked but not the content they label.
- A count stands in for content: `content` has length 2, but nobody checks
  that one block is the image and one the text.
- A validation error is asserted only as non-null, so any message (or the
  wrong field's error) passes.
- After a write, the stored row is checked only for existence, so a "disable"
  that leaves the account active passes. (Not reading the store at all is
  F6.3.)

**Audit labels:** EXISTS-ONLY, TYPE-NOT-VALUE, EVENT-TYPE-NOT-PAYLOAD,
METADATA-NOT-CONTENT, COUNT-NOT-CONTENT, LOOSE-MATCH, RESULT-NOT-PERSISTED,
WEAK-ASSERT

### F1.3 — Count or content instead of ownership

*The bug is an association error: the right things are present, but attached
to the wrong entity, and the test's assertions are aggregate or unscoped (a
count, a page-wide match, a set of bare values), so they discard which
entity each one belongs to. (An individual assertion whose target is
selected by position is F1.6. A count that hides wrong content, with no
association involved, is F1.2.)*

**Contract:** each locked role's row, and only that row, shows the lock
mark.

**How to spot it:** the test asserts how many marks, rows or results exist,
or that some text appears on the page, and never which entity each one is
attached to.

**Code under test**
```tsx
type Role = { id: string; name: string };
type Props = { roles: Role[]; lockedIds: string[] };

export function RoleTable({ roles, lockedIds }: Props) {
  const locked = roles.map((r) => lockedIds.includes(r.id));
  const sorted = [...roles].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <table><tbody>
      {sorted.map((r, i) => (
        <tr key={r.id}>
          <td>{r.name}</td>
          <td>{/* BUG: flags are in input order, rows are sorted */}{locked[i] && <span aria-label="locked" />}</td>
        </tr>
      ))}
    </tbody></table>
  );
}
```

**Bad test**
```tsx
// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

it('marks locked roles', () => {
  const viewer = { id: 'r3', name: 'Viewer' };
  const editor = { id: 'r2', name: 'Editor' };
  const admin = { id: 'r1', name: 'Admin' };
  render(<RoleTable roles={[viewer, editor, admin]} lockedIds={[admin.id, editor.id]} />);
  expect(screen.getAllByLabelText('locked')).toHaveLength(2);
});
```

**Bug it lets through:** Viewer shows as locked and Admin as editable. There
are still two lock marks.

**Correct test**
```tsx
// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';

it('marks locked roles', () => {
  const viewer = { id: 'r3', name: 'Viewer' };
  const editor = { id: 'r2', name: 'Editor' };
  const admin = { id: 'r1', name: 'Admin' };
  render(<RoleTable roles={[viewer, editor, admin]} lockedIds={[admin.id, editor.id]} />);
  const row = (name: string) => screen.getByText(name).closest('tr')!;
  expect(within(row('Admin')).queryByLabelText('locked')).not.toBeNull();
  expect(within(row('Editor')).queryByLabelText('locked')).not.toBeNull();
  expect(within(row('Viewer')).queryByLabelText('locked')).toBeNull();
});
```
**Fails because:** the input order is `[Viewer, Editor, Admin]`, so the flags
are `[false, true, true]`, but they are paired with the sorted rows
`[Admin, Editor, Viewer]`. Admin gets no mark and Viewer gets one. The
fixture must arrive in a different order from the display order; already
sorted input hides the bug. Nothing is faked; the real component renders.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** assert which entity owns each result, not how many results exist or
that the content appears somewhere.

**When it doesn't apply:** not applicable when the items have no identity
(N identical placeholders or skeleton rows), because then the count is the
whole contract.

**Other forms:**
- Comparing sets of bare names or IDs hides a misclassified entry whenever
  another entity legitimately has the same name.
- The right content is attached to the wrong record.
- The test checks that a value *changed* to some valid-looking content, not
  that it changed to the content that belongs to this entity, so another
  file's text in the editor passes.
- Backend / CLI / DB: a query returns the right number of permission rows
  but joined to the wrong `user_id`, or a CLI report prints the right number
  of `FAILED` lines against the wrong file names. Assert `(owner, value)`
  pairs, not `rows.length`.

**Audit labels:** IDENTITY-COLLAPSED, CONTENT-NOT-IDENTITY,
VALUE-CHANGED-NOT-CORRECT

### F1.4 — Source-text wiring: the source is grepped, not run

*The test reads program source as text and asserts on that text, so an edit
that keeps the text but breaks the behaviour passes. (If the test executes
helpers but never the code that calls them, see F2.3. If the text scanned is
a stylesheet and the claim is layout, F1.5 takes precedence.)*

**Contract:** after the guest changes, load failures on the new guest are
reported.

**How to spot it:** the test calls `readFileSync` (or `?raw`, or a glob) on a
source file and asserts with `toMatch` or `toContain` on its text.

**Code under test**
```ts
import { useEffect, useState } from 'react';

export type FailEvent = { errorCode: number };
type Guest = {
  addEventListener(type: 'did-fail-load', h: (e: FailEvent) => void): void;
  removeEventListener(type: 'did-fail-load', h: (e: FailEvent) => void): void;
};

export function useWebviewErrors(guest: Guest, resetKey: number) {
  const [error, setError] = useState<{ code: number } | null>(null);
  useEffect(() => {
    const onFail = (e: FailEvent) => setError({ code: e.errorCode });
    guest.addEventListener('did-fail-load', onFail);
    return () => guest.removeEventListener('did-fail-load', onFail);
  }, [resetKey]);                       // BUG: `guest` dropped from the deps
  return error;
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/useWebviewErrors.ts', 'utf8');
it('re-attaches the failure listener when the guest changes', () => {
  expect(src).toMatch(/addEventListener\('did-fail-load'/);
  expect(src).toMatch(/resetKey\]/);
});
```

**Bug it lets through:** after the user switches to a second guest, its load
failures are never reported.

**Correct test**
```ts
// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';

function fakeGuest() {
  const handlers = new Set<(e: FailEvent) => void>();
  return {
    addEventListener: (_t: 'did-fail-load', h: (e: FailEvent) => void) => { handlers.add(h); },
    removeEventListener: (_t: 'did-fail-load', h: (e: FailEvent) => void) => { handlers.delete(h); },
    emit: (e: FailEvent) => handlers.forEach((h) => h(e)),
  };
}

it('re-attaches the failure listener when the guest changes', () => {
  const guestA = fakeGuest();
  const guestB = fakeGuest();
  const { rerender, result } = renderHook(({ guest }) => useWebviewErrors(guest, 0),
    { initialProps: { guest: guestA } });
  rerender({ guest: guestB });
  act(() => guestB.emit({ errorCode: -105 }));
  expect(result.current?.code).toBe(-105);
});
```
**Fails because:** with `[resetKey]` as the deps, the rerender does not
re-run the effect, so `guestB` has no listener, the emit reaches nothing, and
`result.current` stays `null`. The guest is safe to fake as long as it keeps
real add/remove semantics; the hook and React's effect scheduling must stay
real, because the bug lives in the deps array.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** execute the wiring. If a text scan is truly the only option, pin the
exact location (the full deps array, the specific element, the specific
branch) so that no edit elsewhere in the file can satisfy it.

**When it doesn't apply:** not applicable when the source text is itself the
deliverable (a licence header, a banned-import rule, a generated file kept in
sync), because there the text is the contract, not a proxy for behaviour.

**Other forms:**
- A hook's effects (an error handler, a stall timer, an event filter) are
  only regex-matched, never run, so a handler that ignores the event or a
  wrong timer duration passes.
- When the text *is* the deliverable but the test's own scanner cannot see
  it, see F5.6.

**Audit labels:** SOURCE-TEXT-WIRING, UNEXECUTED-CODE

### F1.5 — CSS text instead of layout

*The test checks that a style declaration exists, not the layout it is meant
to produce. This entry takes precedence over F1.4 whenever the claim is about
geometry (size, wrapping, overflow, position).*

**Contract:** a long unbroken token wraps inside the card body instead of
overflowing it.

**How to spot it:** the test reads a stylesheet (or `getComputedStyle`) and
asserts that a property is set, and never measures a box.

**Code under test**
```css
/* src/card.css */
.card .body { overflow-wrap: anywhere; white-space: pre; }  /* BUG: `pre` disables wrapping; should be `pre-wrap` */
```

**Bad test**
```ts
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/card.css', 'utf8');
it('long tokens wrap inside the card', () => {
  expect(css).toContain('overflow-wrap: anywhere');
});
```

**Bug it lets through:** long tokens overflow the card and get clipped.

**Correct test**
```ts
// Playwright, real layout
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const css = readFileSync('src/card.css', 'utf8');
test('long tokens wrap inside the card', async ({ page }) => {
  await page.setContent(`
    <style>${css}</style>
    <div class="card" style="width: 200px">
      <div class="body">${'x'.repeat(400)}</div>
    </div>`);
  const overflow = await page.locator('.card .body')
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
```
**Fails because:** `white-space: pre` forbids soft wrapping, so
`overflow-wrap` never gets a chance to break the token, and the body's
`scrollWidth` exceeds its 200px `clientWidth`. The page markup is safe to
fake; the real stylesheet and a real layout engine must stay, because the
bug is an interaction between two properties.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** a declaration being present does not prove the layout it is meant
to produce, because interacting properties can cancel it. Check layout in a
real browser.

**When it doesn't apply:** not applicable when the stylesheet text is the
deliverable (a design-token export, a lint for banned properties), because
there the declaration is the contract, not a proxy for layout.

**Other forms:**
- `max-height` without `overflow: auto` does not produce a scrolling list.
- Backend / CLI / DB: a test asserts that a config file contains
  `timeout = 30` instead of loading the config and checking the effective
  timeout (a later override cancels it), or that a migration's SQL contains
  `CREATE INDEX` instead of checking the query plan actually uses the index.

**Audit labels:** CSS-TEXT-NOT-LAYOUT

### F1.6 — Selected by position instead of identity

*The test picks the item it checks by position (a call index, a row number,
array order) and never reads the key that identifies it, so swapping
identities while keeping positions passes. (Here an individual assertion's
target is selected by position; aggregate or unscoped assertions that discard
ownership are F1.3.)*

**Contract:** `slow_running` events render as a progress bar and `ui_card`
events render as a card.

**How to spot it:** the test reads `mock.calls[0]`, `rows[1]` or `items[2]`
and asserts on its value without checking the name, ID or key in that slot.

**Code under test**
```ts
type Renderer = (payload: unknown) => string;
export type Register = (eventName: string, render: Renderer) => void;

export const renderProgress: Renderer = () => 'progress-bar';
export const renderCard: Renderer = () => 'card';

export function registerRenderers(register: Register) {
  register('ui_card', renderProgress);       // BUG: event names swapped; 'slow_running' must get renderProgress
  register('slow_running', renderCard);
}
```

**Bad test**
```ts
import { it, expect, vi } from 'vitest';

it('renders slow_running events as a progress bar', () => {
  const register = vi.fn<Register>();
  registerRenderers(register);
  const renderer = register.mock.calls[0][1];   // assumes the first registration is slow_running
  expect(renderer(null)).toBe('progress-bar');
});
```

**Bug it lets through:** slow-running events show as a card and cards show
as a progress bar. The first registration still holds the progress renderer,
only under the wrong name.

**Correct test**
```ts
import { it, expect, vi } from 'vitest';

it('renders slow_running events as a progress bar', () => {
  const register = vi.fn<Register>();
  registerRenderers(register);
  const byName = new Map(register.mock.calls);   // each call is [eventName, render]
  expect(byName.get('slow_running')?.(null)).toBe('progress-bar');
  expect(byName.get('ui_card')?.(null)).toBe('card');
});
```
**Fails because:** the lookup goes through the event name, which is the
identity the dispatcher uses. On the bug `slow_running` maps to
`renderCard`, so the first assertion gets `'card'`. The test also stops
depending on registration order, so reordering the two correct lines (a
harmless edit that turns the bad test red) no longer matters. Faking
`register` is safe because the (name, renderer) pairs are the contract; the
real `registerRenderers` must run.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** select what you assert on by its semantic key (name, ID, label),
never by its position, unless the position is itself the contract.

**When it doesn't apply:** not applicable when the order is the specified
behaviour (a sorted list, an ordered pipeline), because there the position is
the identity; assert the key in that slot as well.

**Other forms:**
- A table test reads the status cell of `rows[1]`, assuming it is the admin
  row. A sort change puts another user in that slot, and the test passes
  whenever that user happens to have the same status.
- Backend / CLI / DB: a test reads `result.rows[0]` after a query with no
  `ORDER BY`, or the third line of CLI output, assuming which record or file
  it describes.

**Audit labels:** ENV-DEPENDENT

---

## F2 — Called, not worked

### F2.1 — The call is asserted instead of its effect

*A spy proves the code tried. The state the call was meant to produce is
never checked. (Logging is a subtype: see F5.3. A spy on the wrong object is
F2.2.)*

**Contract:** when editing starts, the field is enabled and holds keyboard
focus.

**How to spot it:** the only assertion is `toHaveBeenCalled` on a spy of the
method that was supposed to produce the outcome (`focus`, `save`, `invalidate`).

**Code under test**
```ts
export function startEditing(input: HTMLInputElement) {
  input.focus();             // BUG: the input is still disabled here, so focus() does nothing
  input.disabled = false;
}
```

**Bad test**
```ts
// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';

function disabledField() {
  const input = document.createElement('input');
  input.disabled = true;
  document.body.append(input);
  return input;
}

it('focuses the field when editing starts', () => {
  const input = disabledField();
  const focus = vi.spyOn(input, 'focus');
  startEditing(input);
  expect(focus).toHaveBeenCalled();
});
```

**Bug it lets through:** the field never receives focus, so the user's
keystrokes go nowhere.

**Correct test**
```ts
// @vitest-environment jsdom
import { it, expect } from 'vitest';

function disabledField() {
  const input = document.createElement('input');
  input.disabled = true;
  document.body.append(input);
  return input;
}

it('focuses the field when editing starts', () => {
  const input = disabledField();
  expect(document.activeElement).not.toBe(input);   // starts unfocused
  startEditing(input);
  expect(input.disabled).toBe(false);
  expect(document.activeElement).toBe(input);
});
```
**Fails because:** a disabled form control is not focusable, so `focus()` on
it is a silent no-op in both browsers and jsdom, and `document.activeElement`
stays on `<body>`. The DOM's focus rules must stay real: do not stub `focus`.
Building the input by hand is safe because the behaviour lives in the DOM, not
in a framework.

**Verify:** the bad test passes on the buggy code; the correct test fails on
it and passes after the fix (revert the fix → red).

**Rule:** assert the state the call was supposed to produce, such as
`document.activeElement`, the value, or the visible row. A call means "we
tried", not "it worked".

**When it doesn't apply:** not applicable when the call itself is the promise
(a callback prop, a port, an event bus), because then delivery is the outcome.
See F2.5 and Review Protocol rule 4.

**Other forms:**
- `focus()` is also a silent no-op when the browser already considers the
  element focused but routes keys elsewhere (the worked incident). In that
  case only a test through real key routing catches it (F3.1).
- A request is asserted to carry an `AbortSignal`, but nothing checks that
  the signal ever aborts, so `new AbortController().signal` passes and a hung
  request still hangs.
- Backend / CLI / DB: the only assertion is a spy on `cache.invalidate()` or
  `tx.commit()`. The spy proves the call, not its effect; the effect is
  checked by an independent read-back (F6.3).

**Audit labels:** CALLED-NOT-WORKED

### F2.2 — Spy on the wrong receiver

*The spy is live and connected, but it records that a method ran without
recording on which object, so a call on the wrong receiver passes. (A spy
that was never handed to the code is a vacuous observation: F5.2.)*

**Contract:** highlighting an option scrolls *that* option into view.

**How to spot it:** the spy is installed on a prototype or another shared
receiver, and the assertion never checks `this` or the arguments.

**Code under test**
```ts
export function highlight(list: HTMLElement, index: number) {
  const rows = list.querySelectorAll<HTMLElement>('[role=option]');
  rows.forEach((r, i) => r.setAttribute('aria-selected', String(i === index)));
  rows[0].scrollIntoView({ block: 'nearest' });       // BUG: always scrolls the first row
}
```

**Bad test**
```ts
// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest';

function optionList(n: number) {
  const list = document.createElement('div');
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.setAttribute('role', 'option');
    list.append(row);
  }
  return list;
}
const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');   // absent in jsdom
afterEach(() => {
  if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

it('scrolls the highlighted option into view', () => {
  const scroll = vi.fn();
  HTMLElement.prototype.scrollIntoView = scroll;          // one spy shared by every element
  highlight(optionList(3), 2);
  expect(scroll).toHaveBeenCalled();
});
```

**Bug it lets through:** the highlighted option stays off-screen.

**Correct test**
```ts
// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest';

function optionList(n: number) {
  const list = document.createElement('div');
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.setAttribute('role', 'option');
    list.append(row);
  }
  return list;
}
const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');   // absent in jsdom
afterEach(() => {
  if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

it('scrolls the highlighted option into view', () => {
  const calls: { row: Element; options: unknown }[] = [];
  HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, options?: unknown) {
    calls.push({ row: this, options });                  // record the receiver, not just the call
  };
  const list = optionList(3);
  highlight(list, 2);
  const rows = list.querySelectorAll('[role=option]');
  expect(calls).toHaveLength(1);
  expect(calls[0].row).toBe(rows[2]);                    // identity, not deep equality
  expect(calls[0].options).toEqual({ block: 'nearest' });
});
```
**Fails because:** the recorder keeps `this`, and `toBe` compares identity, so
a call on `rows[0]` is not accepted as a call on `rows[2]`. Faking
`scrollIntoView` is safe (jsdom has no layout, and the method does not exist
there); the real `highlight` and real DOM nodes must run. A deep-equality
check on the row would be weaker, because sibling rows can be structurally
equal.

**Verify:** the bad test passes on the buggy code; the correct test fails on
it and passes after the fix (revert the fix → red).

**Rule:** when you spy on a shared receiver, assert the receiver identity and
the arguments. It is better still to assert the visible result in a browser.

**When it doesn't apply:** not applicable when the spy sits on one specific
instance that only the code under test can reach, because then the receiver
is already pinned.

**Other forms:** Backend / CLI / DB: a spy on `Pool.prototype.query` or
`Logger.prototype.write` proves a query or a log line happened, but not on
which connection, tenant database or output stream.

**Audit labels:** CALLED-NOT-WORKED

### F2.3 — Effect bodies no test runs

*Inside the unit, the glue never executes: the pure helpers are tested, but
the effect, listener or callback body that calls them runs in no test, or the
subject itself is never called. (Whole bodies that never run belong here;
an omitted case inside a body that does run is F6.2. Asserting on source
text instead of running anything is F1.4. A missing link between two units
is F2.4.)*

**Contract:** a search result arriving during IME composition does not move
focus; outside composition it restores focus to the find input.

**How to spot it:** the tests import only the pure helpers. No test renders
the hook or component, or fires the events its listeners subscribe to.

**Code under test**
```ts
import { useEffect, useRef, type RefObject } from 'react';

export type FindState = { awaitingReport: boolean; composing: boolean };
export type FindBridge = {
  find(q: string): void;
  on(type: 'compositionstart' | 'compositionend' | 'result', cb: () => void): () => void;  // returns an unsubscribe
};

export const shouldRestoreFocus = (s: FindState) => s.awaitingReport && !s.composing;

export function useFindBar(bridge: FindBridge, inputRef: RefObject<HTMLInputElement>) {
  const s = useRef<FindState>({ awaitingReport: false, composing: false });
  useEffect(() => {
    const offs = [
      bridge.on('compositionstart', () => { s.current.composing = true; }),
      bridge.on('compositionend', () => { s.current.composing = false; }),
      bridge.on('result', () => {
        if (s.current.awaitingReport) inputRef.current?.focus();  // BUG: bypasses shouldRestoreFocus
        s.current.awaitingReport = false;
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [bridge, inputRef]);
  return { search: (q: string) => { s.current.awaitingReport = true; bridge.find(q); } };
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';

it('does not steal focus during IME composition', () => {
  expect(shouldRestoreFocus({ awaitingReport: true, composing: true })).toBe(false);
});
```

**Bug it lets through:** a search result arriving mid-composition steals
focus and breaks IME input. The predicate is correct but never called.

**Correct test**
```ts
// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

afterEach(cleanup);

function fakeBridge() {
  const handlers = new Map<string, Set<() => void>>();
  return {
    find: vi.fn(),
    on(type: string, cb: () => void) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(cb);
      return () => { handlers.get(type)!.delete(cb); };
    },
    emit(type: string) { handlers.get(type)?.forEach((cb) => cb()); },  // only registered listeners
  };
}
function attachedInput() {
  const input = document.createElement('input');
  document.body.append(input);
  return { input, inputRef: { current: input } };
}

it('does not steal focus during IME composition', () => {
  const bridge = fakeBridge();
  const { input, inputRef } = attachedInput();
  const { result } = renderHook(() => useFindBar(bridge, inputRef));
  act(() => result.current.search('ab'));
  act(() => bridge.emit('compositionstart'));
  act(() => bridge.emit('result'));
  expect(document.activeElement).not.toBe(input);
});

it('restores focus when a result arrives outside composition', () => {  // control: the listener really runs
  const bridge = fakeBridge();
  const { input, inputRef } = attachedInput();
  const { result } = renderHook(() => useFindBar(bridge, inputRef));
  act(() => result.current.search('ab'));
  act(() => bridge.emit('result'));
  expect(document.activeElement).toBe(input);
});
```
**Fails because:** the real effect registers the real `result` listener, and
that listener focuses the input although composition is in progress. Faking
the bridge is safe as long as it fires only registered listeners (F3.2); the
hook's effect and the DOM focus must stay real. The control test shows the
listener actually runs, so the first test cannot pass merely because nothing
was registered (F5.2).

**Verify:** the bad test passes on the buggy code; the correct test fails on
it and passes after the fix (revert the fix → red).

**Rule:** list every effect, listener and callback body in the unit, and
check that some test executes each one. Testing pure predicates is good, but
it does not replace running the glue that calls them.

**When it doesn't apply:** not applicable when the unit has no effects,
listeners or callbacks (a pure function or a pure render), because then the
helper test does exercise all of the code.

**Other forms:**
- Unexecuted subject: the test never calls the function it is named for. It
  only checks keys or values it wrote into its own fake, so behaviour added
  to or removed from the subject is invisible. (When the file never imports
  the named module at all, see F6.1.)
- A copy-to-clipboard handler is tested, but the sibling copy handlers and
  their reset timers run in no test.
- Backend / CLI / DB: `isRetryable(err)` is unit-tested, but no test delivers
  a message to the queue consumer's `on('message')` handler that should call
  it. Likewise a CLI's `SIGINT` handler or a DB trigger or ORM hook body that
  no test fires.
- The test calls the cleanup itself (for example `controller.abort()`), so
  the production cleanup never runs and deleting it still passes.

**Audit labels:** UNEXECUTED-CODE, FIXTURE-ONLY, TAUTOLOGY

### F2.4 — The connection between units is never proven

*Each unit is tested on its own. Nothing runs them together through the
production registration or composition, so the line that connects them (a
ref, a prop, a call site, a mount, a subscription) can be deleted. (Glue
inside one unit is F2.3; the real implementation behind a fake is F2.6.)*

**Contract:** a card whose content overflows shows a "Show more" button.

**How to spot it:** the hook or helper has its own tests, and the component
that consumes it has none that exercise the hook's outcome.

**Code under test**
```tsx
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

export function useOverflow(ref: RefObject<HTMLElement | null>) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;                                   // nothing attached: never overflowing
    const ro = new ResizeObserver(() => setOver(el.scrollHeight > el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return over;
}

export function OverflowCard({ children }: { children: ReactNode }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const overflowing = useOverflow(bodyRef);
  return (
    <div className="card">
      <div className="body" data-testid="card-body">{children}</div>  {/* BUG: ref={bodyRef} missing */}
      {overflowing && <button>Show more</button>}
    </div>
  );
}
```

**Bad test**
```ts
// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';

class StrictRO {                                       // fires only for elements it was asked to observe
  static all: StrictRO[] = [];
  private targets = new Set<Element>();
  constructor(private cb: ResizeObserverCallback) { StrictRO.all.push(this); }
  observe(el: Element) { this.targets.add(el); }
  unobserve(el: Element) { this.targets.delete(el); }
  disconnect() { this.targets.clear(); }
  static resize(el: Element) {
    for (const ro of StrictRO.all)
      if (ro.targets.has(el)) ro.cb([{ target: el } as ResizeObserverEntry], ro as unknown as ResizeObserver);
  }
}
globalThis.ResizeObserver = StrictRO as unknown as typeof ResizeObserver;

function setSize(el: HTMLElement, scrollHeight: number, clientHeight: number) {  // jsdom has no layout
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
}

it('shows "Show more" when content overflows', () => {
  const el = document.createElement('div');
  setSize(el, 900, 200);
  const ref = { current: el };
  const { result } = renderHook(() => useOverflow(ref));
  act(() => StrictRO.resize(el));
  expect(result.current).toBe(true);
});
```

**Bug it lets through:** the card's ref is never attached, so the hook
observes nothing and the "Show more" button never appears on overflowing
cards.

**Correct test**
```tsx
// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';

class StrictRO {                                       // the same strict fake, repeated so this file stands alone
  static all: StrictRO[] = [];
  private targets = new Set<Element>();
  constructor(private cb: ResizeObserverCallback) { StrictRO.all.push(this); }
  observe(el: Element) { this.targets.add(el); }
  unobserve(el: Element) { this.targets.delete(el); }
  disconnect() { this.targets.clear(); }
  static resize(el: Element) {
    for (const ro of StrictRO.all)
      if (ro.targets.has(el)) ro.cb([{ target: el } as ResizeObserverEntry], ro as unknown as ResizeObserver);
  }
}
globalThis.ResizeObserver = StrictRO as unknown as typeof ResizeObserver;

function setSize(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
}

it('shows "Show more" when content overflows', () => {
  render(<OverflowCard>{'line\n'.repeat(50)}</OverflowCard>);
  const body = screen.getByTestId('card-body');
  setSize(body, 900, 200);
  act(() => StrictRO.resize(body));
  expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy();
});
```
**Fails because:** the real `OverflowCard` is rendered. With the ref missing,
`useOverflow` sees `null`, returns early and observes nothing. The strict fake
then fires for no one, so the button never appears and `getByRole` throws. The
null guard makes this a clean assertion failure, not a crash. Faking
`ResizeObserver` and the element sizes is safe because jsdom has neither; the
fake must be strict (F3.2), or it would call the callback anyway. The
component and its ref wiring must stay real.

**Verify:** the bad test passes on the buggy code; the correct test fails on
it and passes after the fix (revert the fix → red).

**Rule:** when a hook or helper is tested on its own, add at least one test
that renders the real consumer.

**When it doesn't apply:** not applicable when the unit has no collaborator
wired to it by a ref, prop or registration, because then there is no
connecting line to delete.

**Other forms:**
- A polling helper is tested well, but the call site that starts it with the
  real period is never executed.
- The test rebuilds the production composition by hand (middleware order,
  handler mounting, a `bus.subscribe` → handler line copied from the real
  module) instead of using the real one, so deleting or reordering the real
  mount or subscription passes.
- Backend / CLI / DB: the handler and the repository each have unit tests,
  but the route is never mounted, the CLI subcommand is never added to the
  command table, or the repository is never registered in the DI container.
  Only a test that goes through the real entry point (HTTP request, real
  `argv`, container resolution) catches it.

**Audit labels:** UNEXECUTED-CODE, REIMPLEMENTED-WIRING, SELF-MOCK

### F2.5 — A contract call without its arguments

*The call is legitimately the contract (a callback prop, a port), but the
test checks only that it happened.*

**Contract:** clicking Save calls `onSave` once, with the edited title.

**How to spot it:** a callback prop or port spy is asserted with
`toHaveBeenCalled()` and no argument or count check.

**Code under test**
```tsx
import { useState } from 'react';

export function TitleEditor({ value, onSave }: { value: string; onSave: (title: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <>
      <input aria-label="Title" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button onClick={() => onSave(value)}>Save</button>   {/* BUG: saves the old value */}
    </>
  );
}
```

**Bad test**
```tsx
// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

it('saves the edited title', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<TitleEditor value="Old" onSave={onSave} />);
  await user.clear(screen.getByLabelText('Title'));
  await user.type(screen.getByLabelText('Title'), 'New');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSave).toHaveBeenCalled();
});
```

**Bug it lets through:** every edit is silently discarded on save.

**Correct test**
```tsx
// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

it('saves the edited title', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<TitleEditor value="Old" onSave={onSave} />);
  await user.clear(screen.getByLabelText('Title'));
  await user.type(screen.getByLabelText('Title'), 'New');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledWith('New');
});
```
**Fails because:** the buggy click calls `onSave('Old')`, and the exact
argument check rejects it. The fixture starts from a value (`Old`) that
differs from the edit (`New`), so passing the prop through cannot match.
Faking `onSave` is safe because the call is the contract here; the component's
state and the click must stay real.

**Verify:** the bad test passes on the buggy code; the correct test fails on
it and passes after the fix (revert the fix → red).

**Rule:** if a call is the contract (Review Protocol rule 4), assert its exact
arguments and its count.

**When it doesn't apply:** not applicable when the call is not the contract
and the test names an outcome, because then assert the outcome itself (F2.1).

**Other forms:**
- Typing in a field asserts `setTitle` was called, never with which value, so
  wiring the input to the wrong setter or argument passes.
- A client's request recorder keeps only the URL, so the method and body of
  the call (a token-redemption `POST`, say) are never asserted. If the fake
  also answers every request the same way, see F3.6.
- Backend / CLI / DB: a service test asserts `publisher.publish` or
  `repo.save` was called without checking the event payload or the row, or a
  CLI test asserts `process.exit` was called without checking the exit code.

**Audit labels:** LOOSE-MATCH, MOCKED-SUBJECT

### F2.6 — The real implementation behind a fake never runs

*Each test legitimately fakes the layer below it. But no test anywhere runs
the real implementation behind that fake (the adapter, client or store), so
its bugs are invisible.* (When the unit a test is named for is itself mocked
in that test, see F3.4. When the missing piece is the production mount or
registration that connects units, see F2.4.)

**Contract:** renaming a site sends `PATCH /api/sites/<id>` with body
`{ name }`, as the server expects.

**How to spot it:** every test that touches the port injects a fake. Search
the test suite for the adapter's constructor (`httpSitePort`): no test calls
it.

**Code under test**
```ts
// port
export type SitePort = { rename(id: string, name: string): Promise<unknown> };

// adapter
export function httpSitePort(fetchFn: typeof fetch = fetch): SitePort {
  return {
    rename: (id, name) =>
      fetchFn(`/api/sites/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: name }),   // BUG: the server expects `name`
      }).then((r) => r.json()),
  };
}

// hook
export function useRenameSite(port: SitePort) {
  return (id: string, name: string) => port.rename(id, name);
}
```

**Bad test**
```ts
// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

it('renames the site', async () => {
  const port = { rename: vi.fn().mockResolvedValue({ id: 's1', name: 'New' }) };
  const { result } = renderHook(() => useRenameSite(port));
  await result.current('s1', 'New');
  expect(port.rename).toHaveBeenCalledWith('s1', 'New');
});
```

**Bug it lets through:** the server ignores every rename in production.
Because every test injects a fake port, the adapter's URL, method and body
never run.

**Correct test**
```ts
import { it, expect, vi } from 'vitest';

it('sends the new name to the site endpoint', async () => {
  const fetchFn = vi.fn().mockResolvedValue(new Response('{"id":"s1","name":"New"}'));
  await httpSitePort(fetchFn).rename('s1', 'New');
  expect(fetchFn).toHaveBeenCalledTimes(1);
  const [url, init] = fetchFn.mock.calls[0];
  expect(url).toBe('/api/sites/s1');
  expect(init.method).toBe('PATCH');
  expect(JSON.parse(init.body)).toEqual({ name: 'New' });
});
```
**Fails because:** it runs the real adapter, so the body it builds is
`{ title: 'New' }` and the exact check rejects it. Only the layer below the
adapter (`fetch`) is faked, which is safe because the assertion is on the
request the adapter produces; the adapter itself must stay real. The bad test
is not wrong on its own: faking the port is fine for a hook test. The defect
is that no test anywhere runs the real port. That is what separates this
entry from F3.4, where the test mocks the very unit it is named for.

**Verify:** the bad test passes on the buggy code; the correct test fails on
it and passes after the fix (revert the fix → red).

**Rule:** a fake at one layer is fine only if some other test runs the real
code behind it. For every port, adapter, client or composition root, check
that at least one test executes the real implementation, faking only the
layer below it.

**When it doesn't apply:** not applicable when the layer behind the fake is
third-party code you do not own and do not configure, because its
correctness is not yours to test. Your adapter around it still is.

**Other forms:**
- A guarantee such as atomicity is proven only against an in-memory double,
  while the real store's transaction is never exercised.
- Every toggle test, for the hook and for the component, runs against a fake
  port or controller, so the real API call (method, path, body key) behind
  the switch never runs.
- Hand-built composition is F2.4; a test file that never imports the module
  it is named for is F6.1.

**Audit labels:** SELF-MOCK / UNEXECUTED-CODE

---

## F3 — Fake world

### F3.1 — Synthetic input that bypasses the real mechanism

*The test delivers input (keys, focus, pointer, text) in a way the user
cannot, skipping the browser or OS step where the behaviour lives. (Host
lifecycle events such as signals, unload, navigation and effect replay are
F3.5.)*

**Contract:** a keyboard user can reach every section control by pressing Tab.

**How to spot it:** the test calls `el.focus()`, `dispatchEvent`, `fireEvent`
or a direct handler instead of the key, pointer or OS path a user would take.

**Code under test**
```tsx
export function Tabs({ onSelect }: { onSelect: (id: string) => void }) {
  return (
    <nav aria-label="Sections">
      <button onClick={() => onSelect('installed')}>Installed</button>
      {/* BUG: tabIndex -1 removes Downloads from the Tab order */}
      <button tabIndex={-1} onClick={() => onSelect('downloads')}>Downloads</button>
    </nav>
  );
}
```

**Bad test**
```tsx
// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

it('keyboard users can reach the Downloads section', () => {
  render(<Tabs onSelect={() => {}} />);
  const downloads = screen.getByRole('button', { name: 'Downloads' });
  downloads.focus();                       // programmatic focus ignores tabIndex -1
  expect(document.activeElement).toBe(downloads);
});
```

**Bug it lets through:** keyboard users can never reach Downloads. The Tab key
skips it, even though programmatic `focus()` lands on it.

**Correct test**
```tsx
// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

it('keyboard users can reach the Downloads section', async () => {
  const user = userEvent.setup();
  render(<Tabs onSelect={() => {}} />);    // order: Installed, then Downloads
  await user.tab();                        // Installed
  await user.tab();                        // Downloads
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Downloads' }));
});
```
**Fails because:** `user.tab()` simulates sequential focus navigation: it
computes the Tab order from the DOM, which excludes `tabIndex={-1}`, and
moves focus along it. On the buggy code the second Tab leaves the nav (focus
returns to the body), so Downloads never has focus. The simulation is enough
here because the bug lives in the DOM's Tab order, which `el.focus()` skips.
It does not press a real key through the browser or OS; when the bug lives in
that routing, only a real-browser or OS-level test reaches it. Faking nothing
is needed. (A WAI-ARIA tablist uses roving `tabIndex={-1}` on purpose; there
the contract is arrow-key movement, driven the same way with
`user.keyboard('{ArrowRight}')`.)

**Verify:** the bad test passes on the buggy code; the correct test fails on it
and passes after the fix (revert the fix → red).

**Rule:** name the mechanism the behaviour depends on (Tab order, native key
routing, IME, clipboard, drag, pointer capture), then drive the test through
it. If the test cannot reach that mechanism, say so explicitly and record
manual evidence instead.

**When it doesn't apply:** not applicable when the behaviour does not depend
on how the input is delivered (for example, a pure validator of a typed
value), because there is no delivery mechanism to bypass.

**Other forms:**
- Playwright `keyboard.type` delivers keys straight to the page, skipping OS
  or embedder key routing (the worked incident).
- `page.fill()` followed by reading the DOM value does not prove the
  framework received the value. Submit the form and assert the saved state.
- Dispatching a synthetic `cancel` event on a `<dialog>`, or calling its
  Escape handler, is not the native Escape key path. Press Escape in a real
  browser and assert the dialog closed.
- Backend / CLI / DB: an HTTP test calls the route handler function directly,
  skipping the router, body parser and auth middleware; a CLI test calls the
  command function with pre-parsed options instead of running the binary with
  real `argv`, so quoting and flag parsing never run.

**Audit labels:** SYNTHETIC-INPUT

### F3.2 — A fake fires events the real source would not

*Event-delivery eligibility: the fake fires a callback whatever topic,
target, event type or schedule was registered, so it certifies an
observation the code never set up. (Dropped registrations are F3.3; ignored
request arguments are F3.6.)*

**Contract:** a price published on the symbol's feed topic `price:<SYMBOL>`
above the limit raises an alert.

**How to spot it:** the fake captures "the" callback and the test calls it
directly; the fake never looks at the topic, target or event type the code
registered.

**Code under test**
```ts
export type Bus = { subscribe(topic: string, cb: (price: number) => void): void };

export function watchPrice(bus: Bus, symbol: string, limit: number, alert: (p: number) => void) {
  bus.subscribe(`price:${symbol.toLowerCase()}`, (p) => {   // BUG: the feed publishes on `price:<SYMBOL>` (upper case)
    if (p > limit) alert(p);
  });
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';

it('alerts when the price crosses the limit', () => {
  let fire!: (p: number) => void;
  const bus: Bus = { subscribe: (_topic, cb) => { fire = cb; } };   // fires for any topic
  const alerts: number[] = [];
  watchPrice(bus, 'ACME', 100, (p) => alerts.push(p));
  fire(120);
  expect(alerts).toEqual([120]);
});
```

**Bug it lets through:** in production no alert ever fires, because nothing
is ever published on the lower-case topic the code subscribed to.

**Correct test**
```ts
import { it, expect } from 'vitest';

class StrictBus implements Bus {
  private subs = new Map<string, ((p: number) => void)[]>();
  subscribe(topic: string, cb: (p: number) => void) {
    this.subs.set(topic, [...(this.subs.get(topic) ?? []), cb]);
  }
  publish(topic: string, p: number) {
    for (const cb of this.subs.get(topic) ?? []) cb(p);
  }
}

it('alerts when the price crosses the limit', () => {
  const bus = new StrictBus();
  const alerts: number[] = [];
  watchPrice(bus, 'ACME', 100, (p) => alerts.push(p));
  bus.publish('price:ACME', 120);            // the topic the real feed uses
  expect(alerts).toEqual([120]);
});
```
**Fails because:** the strict fake delivers only to callbacks registered on
the published topic. The buggy code registered `price:acme`, so publishing on
`price:ACME` reaches nobody and `alerts` stays `[]`. Faking the bus is safe;
what must stay real is the routing rule (topic → subscribers) and the topic
name the real feed publishes on, taken from its spec.

**Verify:** the bad test passes on the buggy code; the correct test fails on it
and passes after the fix (revert the fix → red).

**Rule:** a fake event source fires only for what was actually registered
with it, and only for the event type registered.

**When it doesn't apply:** not applicable when the unit registers nothing
(it is handed values directly rather than subscribing), because there is no
registration for a fake to ignore.

**Other forms:**
- A fake `ResizeObserver` fires its callback whichever element was observed,
  so code that observes a wrapper whose size never changes still "detects"
  overflow.
- A fake DOM or emitter listener fires for any event name, hiding a typo in
  the event type.
- Fake timers fire the callback without regard to the requested period, so a
  wrong interval passes.

### F3.3 — A fake keeps less state than the real thing

*Retained state and cardinality: the fake overwrites, drops or never undoes
what the real dependency would keep (extra listeners, earlier values,
rolled-back writes), so duplicates or leftovers are invisible. (When to fire
is F3.2; what the request said is F3.6.)*

**Contract:** after a reconnect, each streamed token is recorded exactly once.

**How to spot it:** the fake stores a single slot (`this.listener = cb`, one
timer, one value) where the real dependency keeps a list or a map, or returns
a no-op unsubscribe.

**Code under test**
```ts
export type ChatBridge = { onToken(cb: (t: string) => void): () => void };  // returns an unsubscribe

export function createChatSession(bridge: ChatBridge) {
  const tokens: string[] = [];
  return {
    tokens,
    connect() {
      bridge.onToken((t) => tokens.push(t));   // BUG: the previous listener is never unsubscribed
    },
  };
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';

it('records each streamed token once after a reconnect', () => {
  const bridge = {
    listener: null as null | ((t: string) => void),
    onToken(cb: (t: string) => void) { this.listener = cb; return () => {}; },  // keeps only the last listener
  };
  const session = createChatSession(bridge);
  session.connect();
  session.connect();                           // reconnect
  bridge.listener!('a');
  expect(session.tokens).toEqual(['a']);
});
```

**Bug it lets through:** after any reconnect every token appears twice (or
more) in the chat, because each old listener is still attached.

**Correct test**
```ts
import { it, expect } from 'vitest';

it('records each streamed token once after a reconnect', () => {
  const bridge = {
    listeners: [] as ((t: string) => void)[],
    onToken(cb: (t: string) => void) {
      this.listeners.push(cb);
      return () => { this.listeners = this.listeners.filter((l) => l !== cb); };
    },
    emit(t: string) { for (const l of this.listeners) l(t); },
  };
  const session = createChatSession(bridge);
  session.connect();
  session.connect();                           // reconnect
  bridge.emit('a');
  expect(session.tokens).toEqual(['a']);
});
```
**Fails because:** like the real bridge, the fake keeps every registration
and delivers to all of them. On the buggy code two listeners are attached, so
`tokens` is `['a', 'a']`. With the fix (`off?.(); off = bridge.onToken(...)`)
the first listener is removed and the test passes. Faking the bridge is safe;
what must stay real is that it keeps a list of listeners and that
unsubscribing actually removes one.

**Verify:** the bad test passes on the buggy code; the correct test fails on it
and passes after the fix (revert the fix → red).

**Rule:** fakes must keep every registration, deliver to all of them, and
undo what the real dependency undoes. A fake that is more forgiving than the
real thing hides the bugs you are testing for.

**When it doesn't apply:** not applicable when the real dependency itself
keeps only the latest value (for example, a single-slot `onmessage`
property), because then the single-slot fake matches it.

**Other forms:**
- A fake transaction only records `'rollback'` in a trace and undoes
  nothing, and the test never reads the store, so a write that survives a
  failed transaction passes.
- UI: an effect that subscribes without returning a cleanup double-subscribes
  under a framework's development-mode effect replay (for example React
  StrictMode); a single-slot fake hides the duplicate.

**Audit labels:** SELF-MOCK

### F3.4 — The unit under test is mocked

*The very code whose behaviour the test names is replaced by a mock in that
test.* (When a lower layer is faked, see F2.6 instead.)

**Contract:** the checkout total is the sum of each item's price plus its tax.

**How to spot it:** a `vi.mock`/`jest.mock`/`patch` targets the module that
holds the logic named in the test title, often with a mock body that
reimplements the correct formula.

**Code under test**
```ts
// pricing.ts
export const priceWithTax = (cents: number, rate: number) =>
  Math.round(cents * rate);                         // BUG: should be cents * (1 + rate)

// checkout.ts
import { priceWithTax } from './pricing';
export type Item = { cents: number; rate: number };
export const checkoutTotal = (items: Item[]) =>
  items.reduce((sum, i) => sum + priceWithTax(i.cents, i.rate), 0);
```

**Bad test**
```ts
import { it, expect, vi } from 'vitest';
import { checkoutTotal } from './checkout';

vi.mock('./pricing', () => ({
  priceWithTax: (c: number, r: number) => Math.round(c * (1 + r)),
}));

it('checkout total includes tax', () => {
  expect(checkoutTotal([{ cents: 100, rate: 0.1 }])).toBe(110);
});
```

**Bug it lets through:** customers are charged only the tax amount, for
example 10 instead of 110.

**Correct test**
```ts
import { it, expect } from 'vitest';
import { checkoutTotal } from './checkout';

it('checkout total includes tax', () => {
  expect(checkoutTotal([{ cents: 100, rate: 0.1 }])).toBe(110);
});
```
**Fails because:** the real `priceWithTax` runs, so the buggy formula returns
`Math.round(100 * 0.1)` = 10 and the total is 10, not 110. Nothing here needs
faking; the tax calculation is the claim, so it must stay real.

**Verify:** the bad test passes on the buggy code; the correct test fails on it
and passes after the fix (revert the fix → red).

**Rule:** never mock the unit, or the part of it that holds the behaviour the
test names. Mock only dependencies outside the claim.

**When it doesn't apply:** not applicable when the mocked module is outside
the claim (for example, the test is about summing line items and names no tax
behaviour, and a separate test covers `priceWithTax`), because then it is an
ordinary dependency fake; see F2.6.

**Other forms:**
- A gateway is hard-wired to return `FORBIDDEN`, so a "user without the
  permission cannot confirm" test proves only that the error passes through;
  the permission check it names never runs.
- A layout stub derives the expected geometry from the same class the
  assertion checks, so a broken expansion rule passes.
- Backend / CLI / DB: `patch('app.billing.compute_invoice')` in a test named
  for invoice totals.

**Audit labels:** MOCKED-SUBJECT, SELF-MOCK

### F3.5 — Synthetic lifecycle

*The test imitates a host lifecycle (signal, unload, navigation, effect
replay, teardown) with fresh instances, stand-in events or a hand call to
the handler, instead of running the real one. (How user input is delivered
is F3.1.)*

**Contract:** when the platform stops the worker (it sends `SIGTERM`), the
worker persists its pending jobs and exits cleanly.

**How to spot it:** the test calls the shutdown/unload/close handler by hand,
or emits a stand-in event, instead of triggering the lifecycle the host
actually runs.

**Code under test**
```js
// shutdown.mjs
import { writeFileSync } from 'node:fs';

export const pending = ['job-1', 'job-2'];            // accepted, not yet persisted

export function flushPending(outFile) {
  writeFileSync(outFile, JSON.stringify(pending));
}

export function installShutdown(outFile) {
  process.once('SIGINT', () => {                      // BUG: the platform stops workers with SIGTERM, which nothing handles
    flushPending(outFile);
    process.exit(0);
  });
}

// worker.mjs (entrypoint)
import { installShutdown } from './shutdown.mjs';
installShutdown(process.env.OUT_FILE);
process.stdout.write('ready\n');
setInterval(() => {}, 60_000);                        // stay alive until signalled
```

**Bad test**
```ts
import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flushPending } from './shutdown.mjs';

it('persists pending jobs when the worker is stopped', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'worker-')), 'out.json');
  flushPending(out);                                  // the handler, called by hand
  expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(['job-1', 'job-2']);
});
```

**Bug it lets through:** on every deploy or scale-down the worker is killed
by the unhandled `SIGTERM`, and its pending jobs are lost.

**Correct test**
```ts
import { it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

it('persists pending jobs when the worker is stopped', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'worker-')), 'out.json');
  const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url));
  const child = spawn(process.execPath, [worker], { env: { ...process.env, OUT_FILE: out } });
  await once(child.stdout, 'data');                   // "ready": handlers are installed
  child.kill('SIGTERM');                              // the signal the platform sends
  const [code] = await once(child, 'exit');
  expect(code).toBe(0);
  expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(['job-1', 'job-2']);
});
```
**Fails because:** a real process receives the real signal. On the buggy code
`SIGTERM` has no handler, so the default action kills the child: the `exit`
event reports `code` `null` (signal `SIGTERM`) and no file is written. With
the fix (register the handler for `SIGTERM` as well as `SIGINT`) it exits 0
with the jobs persisted. Writing to a temp file instead of the real queue is
safe; the process, the signal and the handler registration must stay real.
Assumes a POSIX host, where `kill('SIGTERM')` delivers a catchable signal.

**Verify:** the bad test passes on the buggy code; the correct test fails on it
and passes after the fix (revert the fix → red).

**Rule:** reproduce the lifecycle through the real host (the real signal, the
framework mode, the real navigation), not by imitating its events or calling
its handler.

**When it doesn't apply:** not applicable when the unit has no host-driven
lifecycle (a pure function or a handler whose registration is covered
elsewhere), because there is no lifecycle to imitate.

**Other forms:**
- A synthetic `pagehide` event does not tear down a document.
- Native key delivery (Escape on a `<dialog>`) is input, not lifecycle: see
  F3.1.
- UI: unmounting and mounting a *fresh* component instance does not
  reproduce a framework's development-mode effect replay (for example React
  StrictMode), which reruns effects on the *same* instance with its state
  kept; render under the real mode instead.

**Audit labels:** SYNTHETIC-LIFECYCLE

### F3.6 — A fake accepts any request

*Request validation: the fake returns success whatever URL, method, header,
ID, body or token it receives, so a wrong request looks right. (Firing events
that were never registered is F3.2; dropping retained state is F3.3.)*

**Contract:** renaming a role sends the draft name to `/roles/<id>` and
returns the role the server saved.

**How to spot it:** the fake's response is a constant (`mockResolvedValue(...)`)
that never reads the URL, method, headers or body it was given.

**Code under test**
```ts
export type Role = { id: string; name: string };
export type Http = { patch(url: string, body: unknown): Promise<Response> };

export async function saveRole(http: Http, role: Role, draftName: string): Promise<Role> {
  const res = await http.patch(`/roles/${role.id}`, { name: role.name });  // BUG: sends the old name, not draftName
  return res.json();
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';

it('renames the role', async () => {
  const http: Http = {
    patch: async () => Response.json({ id: 'r1', name: 'Renamed' }),    // same answer for any request
  };
  const saved = await saveRole(http, { id: 'r1', name: 'Old' }, 'Renamed');
  expect(saved.name).toBe('Renamed');
});
```

**Bug it lets through:** the rename never reaches the server. The role keeps
its old name on the server.

**Correct test**
```ts
import { it, expect } from 'vitest';

it('renames the role', async () => {
  const http: Http = {
    patch: async (url, body) => {
      const { name } = body as { name: string };
      return url === '/roles/r1'
        ? Response.json({ id: 'r1', name })              // saves what it was sent
        : new Response(null, { status: 404 });
    },
  };
  const saved = await saveRole(http, { id: 'r1', name: 'Old' }, 'Renamed');
  expect(saved.name).toBe('Renamed');
});
```
**Fails because:** the fake behaves like the server: it answers with the name
in the request body and rejects other URLs. The buggy code sends
`{ name: 'Old' }`, so the response is `Old` and the assertion fails. Faking
the transport is safe; what must stay real is the dependence of the response
on the request (URL and body).

**Verify:** the bad test passes on the buggy code; the correct test fails on it
and passes after the fix (revert the fix → red).

**Rule:** a fake's response must depend on the request, and the fake must
reject wrong URLs, methods, headers and bodies.

**When it doesn't apply:** not applicable when the request never varies (a
fixed health-check `GET` with no parameters) *and* another test pins its
URL, method and headers against the real client, because then the constant
fake has nothing left to hide. Without that pinning test, a constant fake
still hides a wrong URL, method or header.

**Other forms:**
- An auth check passes with any header value.
- One shared fixture response is returned for every request.
- A fake store ignores the ID it is asked for.
- A generated token (a signed JWT, a checksum) is never inspected because the
  fake consumer accepts any bearer value, so a wrong issuer, swapped
  `iat`/`exp` or a bad signature passes. Decode and verify the token in the
  test, or make the fake verify it.
- A login fake ignores its credentials argument, so submitting an empty
  username still logs in.

**Audit labels:** FAKE-HIDES-BUG, UNEXECUTED-ASSERT

---

## F4 — The test proves itself

### F4.1 — Expected value from the code under test

*The expected value is computed at test time by the production function or its helpers, so expected and actual come from the same code and cannot disagree.*

**Contract:** a user object returned to clients never contains the password field.

**How to spot it:** the expected side of the assertion calls a production function or a helper it uses, e.g. `expect(f(x)).toEqual(helper(x))`.

**Code under test**
```ts
type User = { id: string; email: string; password: string };

export const withoutPassword = (u: User) => ({ ...u });   // BUG: no longer strips the password
export const toPublicUser = (u: User) => withoutPassword(u);
```

**Bad test**
```ts
import { it, expect } from 'vitest';

const user = { id: 'u1', email: 'a@b.c', password: 'h' };

it('never exposes the password', () => {
  expect(toPublicUser(user)).toEqual(withoutPassword(user));
});
```

**Bug it lets through:** password hashes are sent to every client. Both sides of the assertion run the same broken helper, so they agree.

**Correct test**
```ts
import { it, expect } from 'vitest';

it('never exposes the password', () => {
  expect(toPublicUser({ id: 'u1', email: 'a@b.c', password: 'h' }))
    .toEqual({ id: 'u1', email: 'a@b.c' });
});
```
**Fails because:** the expected value is a literal written from the contract, so it does not move when the helper changes. On the bug the actual object carries `password: 'h'`, which the literal lacks. After the fix (`({ password, ...rest }) => rest`) the two match. Nothing needs faking; the helper must stay real, because it is where the bug lives.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** expected values come from an independent source: a literal, the spec, or a separate reference implementation that shares no code with the unit.

**When it doesn't apply:** Not applicable when the test deliberately compares the unit against an independent oracle (a reference implementation or a second system that shares no code with it), because those two can disagree.

**Other forms:**
- Not this entry: a test that never calls the code under test at all is an unexecuted subject (F2.3), and a file that never imports the module it is named for is F6.1.
- Backend/DB: the expected rows or response body are built by calling the same serializer or query builder the endpoint uses.

**Audit labels:** TAUTOLOGY

### F4.2 — Completeness check against a hand-kept list

*A "nothing is missing" test compares two lists a human keeps in sync, so a new item missing from both passes.*

**Contract:** every translation key the source code calls resolves to a string in the default locale.

**How to spot it:** both sides of the completeness check are lists written by hand in the test or next to it; neither is read from the code that uses the items.

**Code under test**
```tsx
// Layout: source in src/, this test in test/i18n.test.ts, run from the project root.

// src/en.ts
export const en: Record<string, string> = { save: 'Save', cancel: 'Cancel' };

// src/i18n.ts
import { en } from './en';
export const t = (key: string) => en[key] ?? key;   // a missing key renders as itself

// src/RenameButton.tsx
import { t } from './i18n';
export const RenameButton = () => <button>{t('rename')}</button>;  // BUG: 'rename' is missing from en
```

**Bad test**
```ts
import { it, expect } from 'vitest';
import { en } from '../src/en';

const CALL_SITE_KEYS = ['save', 'cancel'];          // hand-maintained

it('every used key has a translation', () => {
  expect(new Set(CALL_SITE_KEYS)).toEqual(new Set(Object.keys(en)));
});
```

**Bug it lets through:** users see the raw key `rename` on the button. Nobody added `rename` to either list, so the two lists still match.

**Correct test**
```ts
import { it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../src/en';

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)]);
}

// Collects every literal key passed to t('…') in the source tree.
function scanSourceForTCalls(dir: string): Set<string> {
  const keys = new Set<string>();
  for (const file of listFiles(dir)) {
    if (!/\.tsx?$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bt\(\s*['"]([^'"]+)['"]\s*\)/g)) keys.add(m[1]);
  }
  return keys;
}

it('every used key has a translation', () => {
  const used = scanSourceForTCalls('src');
  expect(used.has('rename')).toBe(true);                       // the scan can see call sites
  const missing = [...used].filter((key) => !Object.hasOwn(en, key));
  expect(missing).toEqual([]);
});
```
**Fails because:** one side of the comparison is derived from the call sites themselves, so a new `t('rename')` enters the check without anyone editing the test. On the bug `missing` is `['rename']`; after adding `rename: 'Rename'` to `en` it is `[]`. The source files and the locale object must stay real; nothing is faked. The `has('rename')` line guards against a scanner that silently finds nothing (F5.2).

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** derive at least one side of a completeness check from the source of truth (the call sites, the routes, the schema), never from a list kept next to the test.

**When it doesn't apply:** Not applicable when the hand-kept list is itself the spec (e.g. a required-fields list copied from the requirements) and the other side is read from the code, because one side is then already independent.

**Other forms:**
- Backend/CLI/DB: a test compares a hand-kept `ROUTES` array, command list or table list to another hand-kept list, instead of reading the router's registered routes, the CLI's parsed command table or the migrated schema.

### F4.3 — Input that does not decide the result

*The input under test never decides the result: its value is one a broken
implementation would turn into the expected answer anyway (a default, an
echo, an identical ordering), or another input changes at the same time and
produces the expected difference on its own.*

**Contract:** a configured `maxItems` value is used instead of the default,
and a value that is not a positive whole number falls back to the default
(5).

**How to spot it:** the fixture value equals a default, a mocked response or
another field, or the "changed" case also changes a second input, so the
output would be the same if the input under test were ignored.

**Code under test**
```ts
type RawConfig = { maxItems?: string };
const DEFAULT_MAX = 5;

export function parseConfig(raw: RawConfig) {
  return { maxItems: DEFAULT_MAX };       // BUG: ignores raw.maxItems
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';

it('reads maxItems', () => {
  expect(parseConfig({ maxItems: '5' }).maxItems).toBe(5);
});
```

**Bug it lets through:** every configured limit is ignored and users always get 5 items.

**Correct test**
```ts
import { it, expect } from 'vitest';

it('reads maxItems', () => {
  expect(parseConfig({ maxItems: '7' }).maxItems).toBe(7);
});

it('falls back to the default for an invalid number', () => {   // sibling: pins the fallback half
  expect(parseConfig({ maxItems: 'x' }).maxItems).toBe(5);
  expect(parseConfig({}).maxItems).toBe(5);
});
```
**Fails because:** `7` is not the default, so ignoring the input gives 5 and the first test goes red. The sibling stays green on the bug (it expects the default); it is there so that a fix which reads the input but forgets the fallback (`Number('x')` is `NaN`) also goes red. The fix that passes both: `const n = Number(raw.maxItems); return { maxItems: Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX };`. Nothing is faked; only the fixture values changed.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** choose input values for which every plausible wrong implementation gives a different answer: non-default, distinct values. When a test compares two runs, change only the input under test between them.

**When it doesn't apply:** Not applicable when the default itself is the behaviour under test (e.g. "a missing `maxItems` falls back to 5"), because there the input is the absence of a value; that test still needs a sibling with a non-default value.

**Other forms:**
- The submitted value equals the mocked response.
- The title order and slug order are identical, so a comparator mix-up is invisible.
- The same value is used for both the "first" and the "latest" item.
- Uncontrolled change to another input: a "the fingerprint changes when the command changes" test also resends a secret, which re-encrypts to new ciphertext, so the fingerprint changes even after the command is dropped from it.
- A "second caller gets a fresh pass" test reads state only after another change has landed, so returning the first caller's in-flight result still shows the new data. Snapshot before the overlap.

**Audit labels:** CONFOUNDED-INPUT

### F4.4 — One guard masking another

*The case is rejected, but by a different guard than the one the test is named for, so deleting the named guard still leaves the case rejected.*

**Contract:** an input with an invalid key is rejected with an `INVALID_KEY` error on `key`.

**How to spot it:** the invalid fixture breaks more than one rule, and the assertion checks only `ok === false` or "some error" without naming which guard fired.

**Code under test**
```ts
type Issue = { path: string; code: string };

export function validate(input: { key: string; field: string }) {
  const errors: Issue[] = [];
  // BUG: the key check was deleted
  if (!/^[a-z]\w*$/.test(input.field)) errors.push({ path: 'field', code: 'INVALID_FIELD' });
  return { ok: errors.length === 0, errors };
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';

it('rejects an invalid key', () => {
  expect(validate({ key: 'bad key!', field: '1nvalid' }).ok).toBe(false);
});
```

**Bug it lets through:** invalid keys are accepted. The fixture's field is also invalid, so the field guard keeps `ok` false.

**Correct test**
```ts
import { it, expect } from 'vitest';

it('rejects an invalid key', () => {
  expect(validate({ key: 'bad key!', field: 'title' }).errors)
    .toEqual([{ path: 'key', code: 'INVALID_KEY' }]);
});
```
**Fails because:** the field `title` is valid, so the key guard is the only one that can fire, and the assertion names it. On the bug `errors` is `[]`. After restoring the key check (`if (!/^[a-z]\w*$/.test(input.key)) errors.push({ path: 'key', code: 'INVALID_KEY' })`) it is exactly the one key error. Nothing is faked.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** make the guard under test the *only* reason the case can fail, and assert which guard fired. (When a fallback produces the same *success* instead, see watch-list item W1.)

**When it doesn't apply:** Not applicable to a test that deliberately checks combined rejection (e.g. "reports every error at once"), because there every guard is named; it must still assert each guard's error.

**Other forms:**
- Missing precondition: the test checks a "malformed provider response" error before any key is entered, so the ordinary missing-key refusal produces the expected error and the malformed-response path is never reached. The setup accepts any error, so it never proves which guard fired. (When the error page makes an absence check pass, see F5.2.)
- Backend/CLI/DB: a request is rejected with 401 by the auth middleware before it reaches the permission check the test is named for; a CLI exits non-zero on a missing argument before the flag check under test runs; an insert fails on a NOT NULL column instead of the unique constraint under test.

**Audit labels:** MASKED-GUARD, MISSING-PRECONDITION

### F4.5 — End state already true before the action

*The pre-existing state seeded before the action already equals the end state the test expects, so an action that does nothing passes.*

**Contract:** assigning a role adds it to the user's stored roles and keeps the roles already there.

**How to spot it:** the setup seeds exactly the state the final assertion expects, and nothing asserts the precondition.

**Code under test**
```ts
export type Role = 'viewer' | 'editor';
export type User = { id: string; roles: Role[] };
export interface Repo { get(id: string): Promise<User>; put(u: User): Promise<void> }

export async function assignRole(repo: Repo, userId: string, role: Role) {
  const u = await repo.get(userId);
  return u;                               // BUG: never adds the role or saves it
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';

function memoryRepo(): Repo {
  const rows = new Map<string, User>();
  return {
    async get(id) {
      const u = rows.get(id);
      if (!u) throw new Error(`no user ${id}`);
      return structuredClone(u);
    },
    async put(u) { rows.set(u.id, structuredClone(u)); },
  };
}

it('assigns the role', async () => {
  const repo = memoryRepo();
  await repo.put({ id: 'u1', roles: ['editor'] });
  await assignRole(repo, 'u1', 'editor');
  expect((await repo.get('u1')).roles).toContain('editor');
});
```

**Bug it lets through:** role assignment silently does nothing, so users never gain the access they were granted.

**Correct test**
```ts
import { it, expect } from 'vitest';

function memoryRepo(): Repo {
  const rows = new Map<string, User>();
  return {
    async get(id) {
      const u = rows.get(id);
      if (!u) throw new Error(`no user ${id}`);
      return structuredClone(u);
    },
    async put(u) { rows.set(u.id, structuredClone(u)); },
  };
}

it('assigns the role', async () => {
  const repo = memoryRepo();
  await repo.put({ id: 'u1', roles: ['viewer'] });
  expect((await repo.get('u1')).roles).not.toContain('editor');   // precondition
  await assignRole(repo, 'u1', 'editor');
  expect((await repo.get('u1')).roles).toEqual(['viewer', 'editor']);
});
```
**Fails because:** the seeded state lacks `editor`, and the precondition proves it, so only the action can produce the end state. On the bug the stored roles stay `['viewer']`. After the fix (`if (!u.roles.includes(role)) u.roles.push(role); await repo.put(u);`) they are `['viewer', 'editor']`. Faking the store with an in-memory repo is safe because it copies on read and write like a real store; reading back through `repo.get` must stay, since that is where the missing write shows.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** seed a starting state that differs from the expected end state, and assert the precondition before the action.

**When it doesn't apply:** Not applicable to an idempotence test ("assigning a role the user already has changes nothing"), because there the unchanged state is the contract; that test still needs a sibling where the state does change.

**Other forms:**
- A reset or clear test starts from an empty state, so there is nothing to clear.
- A preservation test uses default values, so a reset to defaults looks preserved.
- Data left over from earlier runs satisfies the check (left by another test: see F7.5; left on the machine: see F7.2).
- An earlier step already produced the asserted state (for example, a first fill already enabled Save).

**Audit labels:** STATE-NOT-TRANSITION, STALE-EVIDENCE

### F4.6 — Expected value is the bug

*The expected value is a hard-coded literal, but it is wrong: copied from the code's current wrong output, or taken from a contract that is obsolete or incomplete, so the test pins a defect as correct (and may fail the fix).*

**Contract:** durations display as minutes and two-digit, zero-padded seconds (65 000 ms → `1:05`).

**How to spot it:** a hard-coded expected literal disagrees with the spec when worked by hand (unpadded, off by one, wrong unit), or changed in the same commit as the output with no spec change.

**Code under test**
```ts
export function formatDuration(ms: number) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor(ms / 1000) % 60;
  return `${m}:${s}`;                     // BUG: seconds are not zero-padded
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';

it('formats minutes and seconds', () => {
  expect(formatDuration(65_000)).toBe('1:5');    // copied from what the function printed
});
```

**Bug it lets through:** durations show as `1:5` instead of `1:05`. A fix would *fail* this test, so the bug is protected.

**Correct test**
```ts
import { it, expect } from 'vitest';

it('formats minutes and seconds', () => {
  expect(formatDuration(65_000)).toBe('1:05');   // worked from the spec
});
```
**Fails because:** the literal was worked out from the spec, not from running the code, so on the bug the actual `'1:5'` disagrees with `'1:05'`. After the fix (`String(s).padStart(2, '0')`) they match. Nothing is faked; the seconds value (5) is a single digit so the padding rule is actually exercised.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** take expected values from the spec or a hand-worked example, never from running the code and accepting what it printed.

**When it doesn't apply:** Not applicable to a characterization (golden-master) test written deliberately to freeze legacy behaviour before a refactor, because there the current output is the contract; label it as such.

**Other forms:**
- Blindly accepted snapshot updates pin whatever the code rendered, bugs included. An over-broad snapshot (a whole page or response, most of it irrelevant to the test's claim) makes this likely: every unrelated change rewrites it, so reviewers stop reading the diff. Snapshot only the part the claim is about, or assert it explicitly.
- Stale contract: the expected value encodes behaviour the spec has since changed (an unsupported status accepted as success, an error code the current guard no longer returns, a sandbox attribute of a removed preview design), so the test rewards the old behaviour and fails the current one.
- Contract drift: the expected field list omits a field production legitimately returns, so it rejects current output and rewards removing a supported field.
- A known defect recorded as a passing assertion. If a known defect must be recorded, mark the test as an expected failure tied to that specific defect (see W2); never assert the defect as correct.
- Backend/CLI/DB: a golden response file or CLI output fixture regenerated from the current build, or an expected row count copied from the current query result.

**Audit labels:** PINS-BUG, STALE-CONTRACT, CONTRACT-DRIFT, OBSOLETE-TARGET

---

## F5 — Never actually checks

### F5.1 — An assertion that may never run

*The assertion is never reached on the broken code: it sits in a branch,
loop or callback the bug skips, or there is no assertion at all. (An
assertion that runs but cannot fail is F5.2.)*

**Contract:** every unsaved draft appears in the list, marked "Unsaved".

**How to spot it:** an `expect` sits inside an `if`, a loop over results, or a
callback, so the test still passes when it is never reached.

**Code under test**
```tsx
type Draft = { id: string; title: string; saved: boolean };

export function DraftList({ drafts }: { drafts: Draft[] }) {
  return (
    <table>
      <tbody>
        {drafts.filter((d) => d.saved).map((d) => (   // BUG: inverted, so unsaved drafts never render
          <tr key={d.id}><td>{d.title}</td><td>Unsaved</td></tr>
        ))}
      </tbody>
    </table>
  );
}
```

**Bad test**
```tsx
// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

it('marks unsaved drafts', () => {
  render(<DraftList drafts={[{ id: 'd1', title: 'My draft', saved: false }]} />);
  const cell = screen.queryByText('My draft');
  if (cell) expect(cell.closest('tr')!.cells[1].textContent).toBe('Unsaved');
});
```

**Bug it lets through:** unsaved drafts disappear from the list. The test runs
no assertions and still passes.

**Correct test**
```tsx
// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

it('marks unsaved drafts', () => {
  render(<DraftList drafts={[{ id: 'd1', title: 'My draft', saved: false }]} />);
  const row = screen.getByText('My draft').closest('tr')!;   // getBy throws if absent
  expect(row.cells[1].textContent).toBe('Unsaved');
});
```
**Fails because:** `getByText` throws when the buggy filter drops the row, so
the missing draft fails the test instead of skipping it. The component renders
for real. Nothing is faked, and nothing needs to be, because the bug sits in
the render path that the query reads.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** assertions must be unconditional. Use `expect.assertions(n)` or an
awaited promise wherever a callback is involved. (A suite that skips itself
silently is F7.3.)

**When it doesn't apply:** not applicable when the test's own setup fixes the
condition and every branch asserts (for example, a parametrised case that
asserts on both arms), because an assertion then runs on every path.

**Other forms:**
- An assertion inside a callback that is never awaited.
- A test with no assertion at all, or a final step (a Redo click) with none.
- An `expect` inside `if (declaresDisplay)`: when the rule moves, the regex
  stops matching and the test asserts nothing.
- Frames sampled away: a per-frame sampler silently discards frames where the
  element is absent, so the per-frame assertion never runs on exactly the
  frames that show the bug, and "every recorded frame was correct" holds even
  when none were recorded. Record every frame with an explicit "present"
  flag and assert on it. This is F5.1, not F5.2, because the assertion is
  never reached on the frames that matter; F5.2 is an assertion that is
  evaluated on them and is trivially true.
- Backend / CLI / DB: `for (const row of await db.query(sql)) expect(row.status).toBe('active')`
  passes when the query returns zero rows, and a CLI test that loops over the
  lines of stdout passes when the command prints nothing.

**Audit labels:** NO-ASSERT, SAMPLE-DROPS-FAILURE

### F5.2 — Vacuous check: passes when nothing happened

*The assertion runs, but its observation cannot fail: it is trivially true
when the expected thing is missing (an order check on an absent item,
"nothing bad" when nothing happened), or it watches something disconnected
from the action. (An assertion that never runs is F5.1.)*

**Contract:** the menu offers Rescan, listed before Open.

**How to spot it:** an order, absence or "no errors" assertion with no earlier
assertion that the thing it talks about exists.

**Code under test**
```ts
export function menuItems(): string[] {
  return ['open', 'rename'];               // BUG: 'rescan' dropped
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';

it('lists rescan before open', () => {
  const items = menuItems();
  expect(items.indexOf('rescan')).toBeLessThan(items.indexOf('open'));   // -1 < 0
});
```

**Bug it lets through:** the Rescan action vanishes from the menu.

**Correct test**
```ts
import { it, expect } from 'vitest';

it('lists rescan before open', () => {
  const items = menuItems();
  expect(items).toContain('rescan');
  expect(items.indexOf('rescan')).toBeLessThan(items.indexOf('open'));
});
```
**Fails because:** the membership check fails when `rescan` is missing. Without
it, `indexOf` returns `-1`, which is "less than" every real position, so the
order check passes. The function is pure and runs for real, so nothing is
faked.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** prove the thing exists before asserting its order, its absence of
problems, or its "unchanged" state. Before asserting that something is
absent, make sure the query could ever have matched.

**When it doesn't apply:** not applicable when an earlier assertion in the same
test already proves the item is present, or the query is shown to match in a
positive case, because the check can then no longer be satisfied by an empty
result.

**Other forms:**
- "No unsupported types were sent" passes when nothing was sent.
- `undefined` from optional chaining looks the same as "correctly absent".
- `changed: false` holds both for a harmless no-op and for a refused
  operation, because `ok` is never checked.
- An absence check uses a `queryBy…` that matches nothing in any state (for
  example, it asks for an accessible name the element never has, shown or
  not), so "not shown" passes whether or not the element renders. Show the
  same query finding the element in a positive case. (When the test's own
  preprocessing hides text that is present, see F5.6.)
- Disconnected or negative spy: "`onMerged` was not called" is asserted on a
  fresh `vi.fn()` that was never passed to the hook, so it can never observe
  the real call.
- After unmount, `result.current` is frozen, so "state did not change after
  unmount" holds whether or not the cancel guard exists. Likewise, "`act`
  resolved" proves nothing when the framework does not throw on a late
  update.
- "No cursor is sent" reads `mock.calls.at(-1)`, but the call under test
  returned early, so the last call is the initial request, which never had a
  cursor.
- Missing precondition: absence checks ("the widget is not rendered") pass
  because the page request failed and returned an error page. Assert the page
  loaded before asserting what it lacks.

**Audit labels:** ASSERT-VACUOUS, VACUOUS-SUBSET, ABSENCE-MASKS-MISS,
AMBIGUOUS-RESULT, ASSERT-UNREACHABLE, DISCONNECTED-SPY, MISSING-PRECONDITION,
NO-ASSERT

### F5.3 — Log text instead of state

*The logging subtype of F2.1: the test asserts what the code said it would
do (a log line), not what it did. Cite F5.3 when the stand-in is a log or
console message, F2.1 for any other intermediate call.*

**Contract:** after a failed update check, the check runs again after
`RETRY_MS`.

**How to spot it:** the only assertion on the behaviour is a spy on
`console`/a logger, matched against a message such as "retrying".

**Code under test**
```ts
export const RETRY_MS = 30_000;
export type Updater = { fetch: () => Promise<void> };

export async function checkForUpdate(updater: Updater): Promise<void> {
  try {
    await updater.fetch();
  } catch {
    console.error('update check failed, retrying');
    setTimeout(() => checkForUpdate, RETRY_MS);   // BUG: returns the function instead of calling it, so no retry ever runs
  }
}
```

**Bad test**
```ts
import { it, expect, vi, afterEach } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); });

it('retries a failed update check', async () => {
  const updater = { fetch: vi.fn().mockRejectedValueOnce(new Error('offline')) };
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await checkForUpdate(updater);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('retrying'));
});
```

**Bug it lets through:** after one network blip, the app never checks for
updates again.

**Correct test**
```ts
import { it, expect, vi, afterEach } from 'vitest';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('retries a failed update check', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const updater = {
    fetch: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined),
  };
  await checkForUpdate(updater);
  expect(updater.fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(RETRY_MS);
  expect(updater.fetch).toHaveBeenCalledTimes(2);
});
```
**Fails because:** the timer fires, but the buggy callback only returns
`checkForUpdate` without calling it, so `fetch` is still called once. The clock
and the network (`updater.fetch`) are safe to fake. The scheduling code in
`checkForUpdate` must run for real, because that is where the bug is. Silencing
`console.error` is fine as long as nothing asserts on it.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** a log line describes an intention. Assert the state change, unless
the log wording itself is the named contract.

**When it doesn't apply:** not applicable when the log entry is the named
contract (for example, a required audit-log record), because the log is then
the state.

**Audit labels:** LOG-ONLY

### F5.4 — Evidence destroyed before the assertion

*Cleanup (a reset, delete, truncate or unmount) runs between the action and
the assertion and produces the expected end state by itself. (Releasing a
held operation before asserting its in-flight state is F7.1: there nothing
produces the end state, the moment to observe it has passed.)*

**Contract:** after `removeTree(dir)`, the directory no longer exists.

**How to spot it:** a cleanup, reset, truncate or unmount call sits between the
action and the assertion, and touches what the assertion reads.

**Code under test**
```ts
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

export async function removeTree(dir: string): Promise<void> {
  for (const name of await readdir(dir)) {
    await rm(join(dir, name), { recursive: true });
  }
  // BUG: the now-empty directory itself is never removed (missing `await rm(dir, { recursive: true })`)
}
```

**Bad test**
```ts
import { it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let root: string;
let dir: string;
const cleanupFixtures = () => rmSync(root, { recursive: true, force: true });
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'remove-tree-'));
  dir = join(root, 'cache');
  mkdirSync(join(dir, 'sub'), { recursive: true });
  writeFileSync(join(dir, 'sub', 'a.txt'), 'x');
});
afterEach(cleanupFixtures);

it('removes the directory', async () => {
  await removeTree(dir);
  cleanupFixtures();                        // deletes root, and dir with it, regardless
  expect(existsSync(dir)).toBe(false);
});
```

**Bug it lets through:** clearing the cache leaves an empty directory behind,
so anything that checks whether the cache exists still finds it.

**Correct test**
```ts
import { it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'remove-tree-'));
  dir = join(root, 'cache');
  mkdirSync(join(dir, 'sub'), { recursive: true });
  writeFileSync(join(dir, 'sub', 'a.txt'), 'x');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('removes the directory', async () => {
  await removeTree(dir);
  expect(existsSync(dir)).toBe(false);      // cleanup runs later, in afterEach
});
```
**Fails because:** the assertion reads the filesystem straight after the
action, so the empty directory the bug leaves behind is still there. A real
temporary directory is used. Nothing is faked, because the bug is in what
happens on disk. Cleanup still runs, but only after the assertion.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** assert immediately after the action, before any cleanup that could
produce the same result.

**When it doesn't apply:** not applicable when the cleanup touches nothing the
assertion reads (for example, it closes a connection while the assertion
checks a returned value), because it cannot produce the expected state.

### F5.5 — Assertion failure swallowed

*The assertion runs and fails, but the test catches the failure (a `catch`, a
`.catch(() => {})`, a broad `raises` block) and turns it into success. (F5.1
never reaches the assertion; F5.2 reaches one that cannot fail.)*

**Contract:** charging a negative amount throws a `RangeError`.

**How to spot it:** an `expect`, `assert` or "fail here" `throw` sits inside a
`try` whose `catch` accepts any error, or inside a promise chain with a
`.catch` that ignores what it receives.

**Code under test**
```ts
export function charge(amountCents: number) {
  // BUG: the guard `if (amountCents <= 0) throw new RangeError('amount must be positive')` was deleted
  return { charged: amountCents };
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';

it('rejects a negative amount', () => {
  try {
    charge(-500);
    throw new Error('expected charge to throw');   // meant to fail the test...
  } catch (e) {
    expect(e).toBeInstanceOf(Error);               // ...but the catch accepts it as the rejection
  }
});
```

**Bug it lets through:** negative charges go through as refunds nobody
approved. The test's own "should have thrown" error satisfies its catch.

**Correct test**
```ts
import { it, expect } from 'vitest';

it('rejects a negative amount', () => {
  expect(() => charge(-500)).toThrow(RangeError);
});
```
**Fails because:** `toThrow` fails when the function returns normally, and
nothing catches that failure. On the bug `charge(-500)` returns
`{ charged: -500 }`, so the test goes red; with the guard restored it throws
a `RangeError` and passes. Nothing is faked. The same trap exists in the bad
test with `expect.fail(…)` in place of the `throw`, because its assertion
error is also an `Error`.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** never put an assertion, or a "should not get here" failure, inside
a `catch` that can accept it. Prefer `expect(() => …).toThrow(…)` /
`rejects.toThrow(…)` with the specific error type or message. When you must
catch, assert the specific type and message in the `catch` *and* prove the
exception happened: `expect.assertions(n)`, or an explicit failure right
after the call inside the `try` that the `catch` cannot accept.

**When it doesn't apply:** not applicable when the `catch` asserts the
specific error type and message *and* the test proves the exception happened
(`expect.assertions(n)`, or a failure after the call that the `catch` cannot
accept), because a normal return then fails the test and the test's own
failure cannot satisfy the `catch`. A `try` holding only the call is not
enough on its own: if the call returns normally, the `catch` never runs and
nothing fails. `toThrow` is still simpler.

**Other forms:**
- `await save().then(() => expect(state).toBe('saved')).catch(() => {})`
  silences both a failed save and a failed assertion.
- A `softly(fn)` helper logs assertion errors instead of rethrowing them.
- Backend / CLI / DB: in pytest, `with pytest.raises(Exception):` wraps the
  call *and* the assertions after it, so a failing `assert` is the
  "expected" exception; a shell test runs `cmd || true` and then checks only
  that the script reached its end.

### F5.6 — The test's own scanner cannot see what it checks

*The check runs and could fail in principle, but the test's own preprocessing
(a comment stripper, a tokenizer, a hand-written parser) removes or misreads
the very text it inspects, so a negative check passes on content it never
saw. (In F5.2 the subject is absent; here it is present and the test's
tooling hides it. When the text is a proxy for behaviour, see F1.4.)*

**Contract:** the neutral starter template shows no vendor branding.

**How to spot it:** a "must not contain" scan runs over text that a regex
first strips of "comments", and no fixture proves the stripped text still
contains what the scan looks for.

**Code under test**
```html
<!-- templates/footer.html -->
<footer><a href="//partner.example.test">Powered by Acme</a></footer>
<!-- BUG: the line above leaves vendor branding in the neutral template -->
```

**Bad test**
```ts
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Drops comments so commented-out examples are not counted.
const stripComments = (src: string) =>
  src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/.*$/gm, '');

it('the starter template carries no vendor branding', () => {
  const html = stripComments(readFileSync('templates/footer.html', 'utf8'));
  expect(html).not.toMatch(/Acme/);
});
```

**Bug it lets through:** every site built from the "neutral" template shows
the vendor's name. The `//` in the protocol-relative URL looks like a line
comment, so everything after it, the branding included, is stripped before
the scan.

**Correct test**
```ts
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// HTML has only <!-- --> comments; `//` is not comment syntax there.
const stripHtmlComments = (src: string) => src.replace(/<!--[\s\S]*?-->/g, '');

it('the scanner sees text after a protocol-relative URL', () => {   // positive control
  expect(stripHtmlComments('<a href="//x.example.test">Acme</a>')).toMatch(/Acme/);
});

it('the starter template carries no vendor branding', () => {
  const html = stripHtmlComments(readFileSync('templates/footer.html', 'utf8'));
  expect(html).not.toMatch(/Acme/);
});
```
**Fails because:** the stripper now follows HTML comment syntax, so the link
text survives and `not.toMatch(/Acme/)` sees it and goes red. With the
branding removed from the template it passes. The positive control proves
the scanner can see text in the exact shape that fooled the old one. The
template file and the scan must stay real; nothing is faked.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** before trusting a "must not contain" scan, feed its preprocessing a
fixture that contains the forbidden text in each tricky shape (after a URL,
inside a string, across lines) and assert the scan still finds it.

**When it doesn't apply:** not applicable when the scan applies no
preprocessing of its own (it reads plain data, or uses the language's real
parser), because there is no hand-written step to hide the text; a positive
control is still cheap.

**Other forms:**
- A key scanner's regex accepts only single quotes, so `t("rename")` is never
  collected and the completeness check passes with that key missing.
- Backend / CLI / DB: a "no raw SQL concatenation" lint strips `--` comments
  with a regex and so also strips `'--'` inside a string literal, along with
  the concatenation after it.

**Audit labels:** LEXICAL-SCAN-BLIND-SPOT

---

## F6 — Tests the wrong or missing thing

### F6.1 — The name promises more than the body checks

*A test exists for this behaviour by name (its title explicitly claims it),
but its body never exercises the part the name promises. (If no test claims
the behaviour by name, it is F6.2.)*

**Contract:** unchecking a filter removes its key from the query.

**How to spot it:** a verb in the title ("unchecking", "retries", "removes")
that no line of the body performs or asserts.

**Code under test**
```ts
export type Query = Record<string, string>;

export function toggleFilter(q: Query, key: string, value: string, checked: boolean): Query {
  if (checked) return { ...q, [key]: value };
  return q;                                  // BUG: unchecking keeps the key
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';

it('unchecking a filter removes its key', () => {
  expect(toggleFilter({}, 'status', 'draft', true)).toEqual({ status: 'draft' });
});
```

**Bug it lets through:** the list stays filtered after the user unchecks the
filter.

**Correct test**
```ts
import { it, expect } from 'vitest';

it('unchecking a filter removes its key', () => {
  const on = toggleFilter({}, 'status', 'draft', true);
  const off = toggleFilter(on, 'status', 'draft', false);
  expect('status' in off).toBe(false);
});
```
**Fails because:** the body now performs the uncheck that the title names. The
buggy branch returns `on` unchanged, so `status` is still a key. The `in` check
catches a key that is still present even when its value is `undefined`. The
function is pure and runs for real, so nothing is faked.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** read the test name as a spec, and check that every behaviour it
names is exercised and asserted. Rename the test or finish it.

**When it doesn't apply:** not applicable when the title names only what the
body does (a `describe` title that summarises children which each cover their
part is fine), because nothing is promised that goes unchecked.

**Other forms:**
- Wrong subject: the file never imports the module it is named for. It
  asserts properties of a neighbouring library, so a regression in the named
  module is not caught. (A test that imports the subject but never calls it
  is an unexecuted subject, F2.3.)
- Misleading purpose statement: a comment says the test is "expected to fail
  against current source" or describes a guarantee the body no longer
  checks, so reviewers trust coverage that is not there. Fix the statement
  or the body. (A sleep-based absence check in such a test is F7.1.)
- Backend / CLI / DB: `test_migration_is_reversible` runs only the `up`
  migration.
- MISSING-CASE findings whose test title names the omitted case route here;
  the rest route to F6.2.

**Audit labels:** NAME-MISMATCH, WRONG-SUBJECT, FALSE-COMMENT, MISSING-CASE

### F6.2 — The branch that matters has no test

*No test, under any name, exercises the branch: the error path, a second
call, a retry after a failure, a change mid-flight, a timeout. The code
around it does run; one case is omitted. (A title that claims the branch is
F6.1; a whole effect or callback body that never runs is F2.3; a suite that
is skipped or excluded is F7.3.)*

**Contract:** after a failed attempt, a successful retry requests the same
page, appends it, and leaves the loader idle with no error.

**How to spot it:** the test ends at the first failure (or the first success)
and never makes the next call.

**Code under test**
```ts
export type Page = { items: string[]; next: string | null };
export type FetchPage = (cursor: string | null) => Promise<Page>;

export function createLoader({ fetchPage }: { fetchPage: FetchPage }) {
  let items: string[] = [];
  let cursor: string | null = null;
  let loading = false;
  let error: string | null = null;
  return {
    get state() {
      return { items, cursor, loading, error };
    },
    async loadMore() {
      loading = true;
      try {
        const page = await fetchPage(cursor);
        items = [...items, ...page.items];
        cursor = page.next;
        // BUG: an error left by an earlier failed attempt is never cleared (missing `error = null`)
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        loading = false;
      }
    },
  };
}
```

**Bad test**
```ts
import { it, expect, vi } from 'vitest';

it('shows an error when loading more fails', async () => {
  const fetchPage = vi.fn().mockRejectedValueOnce(new Error('offline'));
  const loader = createLoader({ fetchPage });
  await loader.loadMore();
  expect(loader.state.error).toBe('offline');
  expect(loader.state.loading).toBe(false);
});
```

**Bug it lets through:** after a failed attempt, a successful retry loads the
rows but still shows the old error banner. The test stops at the first
failure, so the retry branch is never tested.

**Correct test**
```ts
import { it, expect, vi } from 'vitest';

const page1: Page = { items: ['a', 'b'], next: 'cursor-2' };
const page2: Page = { items: ['c', 'd'], next: 'cursor-3' };

it('a successful retry appends the page and clears the error', async () => {
  const fetchPage = vi.fn()
    .mockResolvedValueOnce(page1)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(page2);
  const loader = createLoader({ fetchPage });

  await loader.loadMore();                 // page 1 loads
  await loader.loadMore();                 // page 2 fails
  expect(loader.state.error).toBe('offline');

  await loader.loadMore();                 // retry
  expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([null, 'cursor-2', 'cursor-2']);  // retry asks for the same cursor
  expect(loader.state.items).toEqual([...page1.items, ...page2.items]);
  expect(loader.state.loading).toBe(false);
  expect(loader.state.error).toBeNull();   // fails on the bug: still 'offline'
});
```
**Fails because:** the test carries on past the failure and makes the retry.
The retry succeeds, but the buggy success path never resets `error`, so the
final assertion sees `'offline'`. The earlier assertions pin the parts the bug
leaves intact, so they stay green. `fetchPage` (the network boundary) is safe
to fake. The loader's own state handling must run for real.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** for every unit, list the branches that are easy to skip (the
error path, a second call, a retry after failure, a change to inputs while
work is in flight, a timeout) and give each one a test. Test what happens
*after* the failure, not only the failure itself.

**When it doesn't apply:** retry, timeout and concurrency tests are not
required for a unit that has no retry, timeout or concurrent behaviour,
because it has no such branch to leave untested. Test the branches the unit
actually has.

**Other forms:**
- A change to the inputs while a request is in flight (for example, the
  filters change mid-request) leaves `loading` stuck at `true`, because the
  stale-response guard also skips the reset, and no test changes the inputs
  while a request is held open. Forcing that overlap needs a held (deferred)
  promise. See F7.1.
- A timeout wrapper (`withTimeout(request())` → `request()`) can be removed
  with every test green when no test reaches the deadline.
- An error handler shows its toast but skips the refresh the spec requires.
- A limit is tested only with fixtures below the limit.
- Cancellation: a cancel test leaves the cancelled request pending forever,
  so it never sees a late response overwrite state. Hold the request with a
  deferred promise, cancel, *then* settle the cancelled work, and assert the
  late response did not change state. Release every pending thing before the
  test ends. See F7.1.
- A copy handler is tested only on success; the path where the clipboard
  rejects the write (as a real clipboard does without permission) runs in
  no test, so a rejection that leaves the "Copied" flag set passes.

**Audit labels:** MISSING-CASE, UNEXECUTED-CODE

### F6.3 — Stops at the response

*The test trusts what the write operation returned (its object, status, or
success flag) and never reads back stored state at all. (Reading back the
durable store but not the in-memory state the running app serves is F6.4.
Reading the stored row but only checking that it exists is F1.2.)*

**Contract:** after `enableIdentity`, the stored identity is enabled.

**How to spot it:** the test asserts only on the mutation's return value or
status, and never reads the state back.

**Code under test**
```ts
export type Identity = { id: string; enabled: boolean };
export type Repo = {
  get(id: string): Promise<Identity>;
  save(row: Identity): Promise<void>;
};

export async function enableIdentity(repo: Repo, id: string) {
  const row = await repo.get(id);
  const updated = { ...row, enabled: true };
  // BUG: `await repo.save(updated)` is missing
  return { status: 200, body: updated };
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';

function memoryRepo(rows: Identity[]): Repo {
  const store = new Map(rows.map((r) => [r.id, { ...r }]));
  return {
    async get(id) { return { ...store.get(id)! }; },   // returns copies, like a real store
    async save(row) { store.set(row.id, { ...row }); },
  };
}

it('enables the identity', async () => {
  const repo = memoryRepo([{ id: 'u1', enabled: false }]);
  const res = await enableIdentity(repo, 'u1');
  expect(res.status).toBe(200);
  expect(res.body.enabled).toBe(true);
});
```

**Bug it lets through:** the UI says the identity is enabled, but after a
reload it is still disabled.

**Correct test**
```ts
import { it, expect } from 'vitest';

function memoryRepo(rows: Identity[]): Repo {
  const store = new Map(rows.map((r) => [r.id, { ...r }]));
  return {
    async get(id) { return { ...store.get(id)! }; },   // returns copies, like a real store
    async save(row) { store.set(row.id, { ...row }); },
  };
}

it('enables the identity', async () => {
  const repo = memoryRepo([{ id: 'u1', enabled: false }]);
  await enableIdentity(repo, 'u1');
  expect((await repo.get('u1')).enabled).toBe(true);    // independent read
});
```
**Fails because:** the read goes through the repository rather than the
function's reply. Nothing was saved, so the stored row is still disabled. An
in-memory repository is a safe fake only if it stores and returns copies.
Otherwise mutating the returned row would leak into the store and hide a
missing `save` (see F3.3).

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** verify mutations through an independent read (repository, reload,
refetch) of the state the running app actually uses, not through the
mutation's own reply.

**When it doesn't apply:** not applicable when the unit persists nothing and
its return value is the whole contract (a pure function), because there is no
state to read back.

**Other forms:**
- Only the HTTP status (200 or 204) is checked after a delete or update.
- A 204 or a receipt response is checked, but the deletion or the
  regenerated content is never read back.
- A spy on `tx.commit()` or `cache.invalidate()` stands in for the read-back
  (see F2.1).

**Audit labels:** RETURNED-NOT-PERSISTED, RESULT-NOT-PERSISTED,
RESPONSE-NOT-PERSISTENCE, STATUS-ONLY, STATUS-NOT-OUTCOME

### F6.4 — Persisted but not active

*The test reads back the durable store (the file, the row) and finds the
write, but never checks the in-memory state the running app actually
serves, so a write that never takes effect until restart passes. (Not
reading back at all is F6.3.)*

**Contract:** after a theme is written, the running site serves the new
theme without a restart.

**How to spot it:** the read-back goes to disk or the database, while the
app serves from a cache, a loaded-once config or a shared in-memory array
that the test never consults.

**Code under test**
```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Theme = { accent: string };

export function createThemeService(dir: string) {
  const file = join(dir, 'theme.json');
  let active: Theme = JSON.parse(readFileSync(file, 'utf8'));   // loaded once, served to every request
  return {
    current: () => active,
    write(theme: Theme) {
      writeFileSync(file, JSON.stringify(theme));
      // BUG: the active copy is never refreshed (missing `active = theme`)
      return { ok: true };
    },
  };
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('a written theme takes effect', () => {
  const dir = mkdtempSync(join(tmpdir(), 'theme-'));
  writeFileSync(join(dir, 'theme.json'), JSON.stringify({ accent: 'blue' }));
  const themes = createThemeService(dir);
  expect(themes.write({ accent: 'red' })).toEqual({ ok: true });
  expect(JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8'))).toEqual({ accent: 'red' });
});
```

**Bug it lets through:** the owner saves a new theme, sees "saved", and the
live site keeps showing the old one until the next restart.

**Correct test**
```ts
import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('a written theme takes effect', () => {
  const dir = mkdtempSync(join(tmpdir(), 'theme-'));
  writeFileSync(join(dir, 'theme.json'), JSON.stringify({ accent: 'blue' }));
  const themes = createThemeService(dir);
  themes.write({ accent: 'red' });
  expect(themes.current()).toEqual({ accent: 'red' });          // what the running app serves
  expect(JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8'))).toEqual({ accent: 'red' });   // survives a restart
});
```
**Fails because:** `current()` is the state requests are served from. On the
bug it still returns `{ accent: 'blue' }`, the value loaded at startup. The
seeded theme differs from the written one, so only a working refresh can
pass (F4.5). A real temporary directory is used and nothing is faked; the
service's cache must stay real, because the bug is that it goes stale.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** after a write, read back through the path the running app uses
(its cache, its loaded config, the next request it serves), as well as the
durable store.

**When it doesn't apply:** not applicable when the app has no in-memory copy
and reads the store on every request, because then the durable store is the
active state.

**Other forms:**
- A settings write updates the database row, but the shared array the
  request handlers read is never refreshed; render a following request
  through the same dependency.
- Backend / CLI / DB: a CLI `config set` writes the file, but a long-running
  daemon keeps the values it loaded at start and the test never queries the
  daemon.

**Audit labels:** PERSISTED-NOT-ACTIVE

### F6.5 — Internal state instead of observable behaviour

*The test reads the unit's internal state (private fields, an internal
store, hook state) instead of the output a caller or user sees, so the state
can be right while the output derived from it is wrong. Such tests also go
red on harmless refactors. (A spy on an outgoing call is F2.1; a mutation's
own reply is F6.3.)*

**Contract:** an added todo appears in the "open" list.

**How to spot it:** the assertion reaches into `.state`, `._cache`, an
instance field or a debug export instead of calling the method, rendering
the view or making the request a real caller would.

**Code under test**
```ts
export type Todo = { title: string; done: boolean };

export function createTodoStore() {
  const state = { todos: [] as Todo[] };
  return {
    state,                                   // exposed for debugging
    add(title: string) { state.todos.push({ title, done: false }); },
    visible(filter: 'all' | 'open') {
      return filter === 'all' ? state.todos : state.todos.filter((t) => t.done);  // BUG: 'open' must keep !t.done
    },
  };
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';

it('adds a todo', () => {
  const store = createTodoStore();
  store.add('Buy milk');
  expect(store.state.todos).toEqual([{ title: 'Buy milk', done: false }]);
});
```

**Bug it lets through:** new todos never appear in the "open" list, which is
the default view. The internal list is correct, so the test passes.

**Correct test**
```ts
import { it, expect } from 'vitest';

it('adds a todo', () => {
  const store = createTodoStore();
  store.add('Buy milk');
  expect(store.visible('open').map((t) => t.title)).toEqual(['Buy milk']);
});
```
**Fails because:** it reads the list the way the view does. On the bug the
"open" filter keeps only finished todos, so the result is `[]`. The
assertion would survive renaming or restructuring `state`, because it uses
only the public method. Nothing is faked.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** assert through the interface a real caller uses (return values,
rendered output, responses), not through the unit's private state.

**When it doesn't apply:** not applicable when the state is itself the
published interface (a reducer's returned state, a state machine's exposed
status), because then reading it is reading the output.

**Other forms:**
- UI: a test reads a hook's internal state or a component instance field,
  and never the rendered text the user sees.
- Backend / CLI / DB: a test asserts on a service's private cache map instead
  of its API response, or on an ORM entity's dirty flags instead of the
  saved row.

---

## F7 — Passes or fails by luck

### F7.1 — Timing and concurrency not controlled

*The ordering, overlap or deadline the test claims to cover is left to the
scheduler (sleeps, unbounded waits, races that never overlap, a held
operation released before the in-flight state is asserted) instead of being
forced. (Cleanup that itself produces the expected end state is F5.4.)*

**Contract:** the refresh starts only after the save has completed.

**How to spot it:** the test sleeps for a guessed duration, then asserts that
both steps happened, and never checks what was still in flight at the
moment the second step began.

**Code under test**
```ts
type Api = { save(): Promise<void>; refresh(): Promise<void> };

export async function saveThenRefresh(api: Api) {
  api.save();                               // BUG: not awaited, so refresh can run before the save lands
  await api.refresh();
}
```

**Bad test**
```ts
import { it, expect, vi } from 'vitest';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

it('refreshes after saving', async () => {
  const api = { save: vi.fn(async () => {}), refresh: vi.fn(async () => {}) };
  void saveThenRefresh(api);
  await sleep(50);
  expect(api.save).toHaveBeenCalled();
  expect(api.refresh).toHaveBeenCalled();
});
```

**Bug it lets through:** the refreshed list sometimes shows the pre-save
data.

**Correct test**
```ts
import { it, expect, vi } from 'vitest';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
// Yields one macrotask turn, so every queued microtask runs first. Not a guessed delay.
const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

it('refreshes only after the save completes', async () => {
  const save = deferred<void>();
  const api = { save: vi.fn(() => save.promise), refresh: vi.fn(async () => {}) };
  const done = saveThenRefresh(api);
  await flushMicrotasks();
  expect(api.refresh).not.toHaveBeenCalled();     // save still held open
  save.resolve();
  await done;
  expect(api.refresh).toHaveBeenCalledTimes(1);
});
```
**Fails because:** the save is held open by the deferred promise, which
forces the "save still in flight" state. The buggy code calls `refresh`
without waiting, so `refresh` has been called by the time of the first
assertion. Both API calls are safe to fake; the real `saveThenRefresh`
must run, and the save must be one that the test resolves, never one that
settles on its own.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** control ordering with deferred promises or fake timers, and test
both settlement orders when a race matters. Polling for an explicit signal,
with a deadline, is fine. Sleeping for a guessed duration is not.

**When it doesn't apply:** not applicable to units with no async ordering,
overlap, retry or timeout behaviour (pure or fully synchronous code),
because there is no schedule to control.

**Other forms:**
- A "concurrent" test whose operations never actually overlap.
- A wait with no deadline.
- An assertion that runs only after the lock or hold has been released, so
  it cannot see the contended state.
- A deadline test asserts only that the autosave happened at some point in
  16 seconds of typing, so the 15-second ceiling could be 5 or 16 seconds.
  Advance fake time to just before and just after the deadline.
- Fixed observation window: two delayed reads of storage miss a transient
  write between them and a write after the last one. Record every write from
  before the action, wait for an explicit settled signal, then assert.
- A `sleep(100)` "nothing happened" check passes whenever the thing is slower
  than the sleep; await a settled flag instead.

**Audit labels:** TIMING-FLAKY, NO-OVERLAP-GUARANTEE, TIMING-NO-DEADLINE,
ASSERT-AFTER-RELEASE, COUNT-NOT-CONTENT, OBSERVATION-WINDOW, FALSE-COMMENT

### F7.2 — Machine or environment dependent

*The result depends on the machine running the test (real home directory,
env vars, existing files, installed software, network) rather than on state
the test sets up. (State left behind by other tests is F7.5 and F7.6; an
unpinned clock or random source is F7.7.)*

**Contract:** a top-level `theme` key in `~/.apprc` sets the theme, as
documented.

**How to spot it:** the test calls the unit with no setup, and the unit
reads the home directory, environment variables or existing files. (A unit
that reads the clock is F7.7.)

**Code under test**
```python
import tomllib
from pathlib import Path

def load_config():
    path = Path.home() / ".apprc"
    data = tomllib.loads(path.read_text()) if path.exists() else {}
    return {"theme": "light", **data.get("ui", {})}   # BUG: the documented key is top-level `theme`
```

**Bad test**
```python
def test_loads_theme():
    assert load_config()["theme"] == "dark"   # reads whatever ~/.apprc the machine has
```

Reproducer: the bad test is green only on a machine whose real `~/.apprc`
still has the old `[ui]` section, as the author's does. To see it green on
purpose, seed that state first, outside the test:

```python
# reproduce_author_machine.py: run once, then run the bad test with this HOME
import pathlib, tempfile
home = pathlib.Path(tempfile.mkdtemp())
(home / ".apprc").write_text('[ui]\ntheme = "dark"\n')   # the legacy shape
print(home)   # then: HOME=<printed path> pytest -k test_loads_theme
```

On a machine with no `~/.apprc` (or a documented top-level `theme`), the same
bad test fails, which is the point: its result comes from the machine.

**Bug it lets through:** every user who follows the docs gets the light
theme. The test passes only on the author's machine.

**Correct test**
```python
def test_loads_theme(tmp_path, monkeypatch):   # pytest built-in fixtures
    monkeypatch.setenv("HOME", str(tmp_path))
    (tmp_path / ".apprc").write_text('theme = "dark"')
    assert load_config()["theme"] == "dark"
```
**Fails because:** the test writes the documented file shape into a home
directory it owns. The buggy code reads only the `[ui]` table, which is
absent, so it returns `"light"`. The home directory is safe to redirect
(`Path.home()` reads `HOME` on POSIX); the real file read and TOML parse must
stay, because the bug is in which key is read.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** tests own their environment. Isolate the filesystem and env vars,
restore them exactly, and never read machine state.

**When it doesn't apply:** not applicable to deliberate environment probes
(an install smoke test, an environment-doctor check), because there the
machine is the subject; keep them labelled and out of the unit gate.

**Other forms:**
- `process.env.HOME = original` sets the string `"undefined"` when the
  variable was originally unset. Delete it instead.
- File mtimes and installed software.
- A hook test relies on real requests failing within five seconds, so a
  stalled request or a different network decides the result. Control every
  load outcome instead.

**Audit labels:** ENV-DEPENDENT

### F7.3 — Relies on a check that never runs

*The assertion is fine, but no gate ever collects and executes it
(typecheck-only files, excluded paths, skipped or conditionally skipped
suites, a script nothing calls).*

**Contract:** `parse` returns a `Config`, so a caller that misuses the
result fails to compile.

**How to spot it:** the check lives in a file or mode that no gate collects:
a `*.test-d.ts` with typecheck off, a path in `exclude`, `describe.skip`,
a `describe.skipIf(...)` that is true on the gate machine, or a script
nothing calls.

**Code under test**
```ts
export type Config = { port: number };

export function parse(raw: string): any {     // BUG: return type widened from Config to any
  return JSON.parse(raw);
}
```

**Bad test**
```ts
// parse.test-d.ts
import { test, expectTypeOf } from 'vitest';
import { parse, type Config } from './parse';

test('parse returns Config', () => {
  expectTypeOf(parse).returns.toEqualTypeOf<Config>();
});
// Never checked: the runner runs without typecheck mode, so *.test-d.ts is not
// collected, and tsconfig.json excludes "**/*.test-d.ts" from `tsc --noEmit`.
```

**Bug it lets through:** every caller loses type safety, and type errors ship
silently.

**Correct test**
```ts
// parse.test-d.ts: the assertion is unchanged
import { test, expectTypeOf } from 'vitest';
import { parse, type Config } from './parse';

test('parse returns Config', () => {
  expectTypeOf(parse).returns.toEqualTypeOf<Config>();
});

// vitest.config.ts: the gate now collects and type-checks it
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { typecheck: { enabled: true, include: ['src/**/*.test-d.ts'] } },
});

// tsconfig.json: "**/*.test-d.ts" removed from "exclude", so the type checker
// sees the file (or point `typecheck.tsconfig` at a tsconfig that includes it).
```
**Fails because:** both halves of the gate now hold: the runner collects the
file, and the type checker it uses no longer excludes it. It compares `any`
with `Config`, and `toEqualTypeOf` rejects `any`, so the gate goes red
("Type 'Config' does not satisfy the constraint 'never'"). With
`parse(raw: string): Config` it passes. Changing only the runner config is
not enough: the file is then collected but still never type-checked, and the
buggy code goes green. The assertion must sit inside `test()`, or typecheck
mode reports "No test suite found in file" on the fixed code too. The old
gate is green only because the suite's runtime test files pass; with none at
all, the runner exits with "No test files found" unless `passWithNoTests` is
set. The new gate needs neither, because typecheck mode counts the
`*.test-d.ts` file as a test file. Nothing is faked; what has to change is
the gate configuration, not the assertion.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** for every check, demonstrate that the gate collects and executes
it: break it once and watch the gate fail.

**When it doesn't apply:** not applicable when the gate's report already
lists the test as collected and executed (not skipped) on the gate machine,
because that is the demonstration this rule asks for. Ordinary runtime tests
can still drop out through `exclude` patterns or skips, so check the report,
not the default.

**Other forms:**
- A describe block is skipped whenever a linked source checkout is absent,
  so on the gate (which has only the installed package) the package's
  components are never checked. Render the installed package instead, or
  fail when the precondition is missing.
**Audit labels:** TYPECHECK-NOT-RUN, TYPE-NOT-CHECKED, ENV-DEPENDENT

### F7.4 — Retry until green

*The test (or the runner) retries a failing attempt and reports the run as
passed once any attempt passes, so a deterministic failure on the first
attempt is discarded. (Timing left to the scheduler is F7.1; here the
failure is reliable and the retry hides it.)*

**Contract:** the first call to `getConfig` returns the stored config.

**How to spot it:** `{ retry: n }` on a test, `retries` in the runner config,
or a hand-written `for (attempt …) try { … } catch {}` loop around
assertions, with no record of the failed attempts.

**Code under test**
```ts
// config.ts
export type Config = { theme: string };
const DEFAULTS: Config = { theme: 'light' };
let cache: Config | null = null;

export async function getConfig(load: () => Promise<Config>): Promise<Config> {
  if (!cache) {
    load().then((c) => { cache = c; });   // BUG: not awaited, so the first call returns DEFAULTS
    return DEFAULTS;
  }
  return cache;
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';

it('returns the stored config', { retry: 2 }, async () => {
  const load = async () => ({ theme: 'dark' });
  expect(await getConfig(load)).toEqual({ theme: 'dark' });
});
```

**Bug it lets through:** every app start shows the default theme until
something calls `getConfig` a second time. The first attempt fails, the
cache fills in the background, and the retry passes.

**Correct test**
```ts
import { it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => { vi.resetModules(); });

it('returns the stored config on the first call', async () => {
  const { getConfig } = await import('./config');   // fresh module: empty cache
  const load = async () => ({ theme: 'dark' });
  expect(await getConfig(load)).toEqual({ theme: 'dark' });
});
```
**Fails because:** there is no retry, and each test gets a fresh module, so
the one attempt is a real first call. On the bug it returns
`{ theme: 'light' }`; with `if (!cache) cache = await load();` it returns the
stored config. `load` is safe to fake; the module's cache must stay real,
because the bug is in how it fills.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** do not retry to get green. If a runner retries, report any test
that needed a retry as a failure to investigate, and keep the failed
attempt's output.

**When it doesn't apply:** not applicable to a retry that is part of the
contract under test (the code under test retries, and the test asserts each
attempt), because then the retries are the behaviour, not the test hiding
it.

**Other forms:**
- A CI-wide `retries: 2` reports a test as green although its first attempt
  failed.
- A Playwright `expect(…).toPass()` block wraps an action together with its
  assertion, so a step that fails the first time for a real reason (a lost
  click, a double submit) is silently repeated until it works. Poll only
  for a signal, never repeat the action.
- Backend / CLI / DB: a shell gate reruns the suite once on failure and
  reports only the second run.

### F7.5 — State shared between tests

*The code under test keeps module-level or global state, and one test passes
only because an earlier test left that state behind, so the result depends
on test order. (Leaked test doubles are F7.6; machine state is F7.2.)*

**Contract:** a new session starts with the English locale (`en`).

**How to spot it:** tests in one file mutate a module's state (a setter, a
cache, a singleton) and no hook resets it; the file passes in order and
fails when one test runs alone or the order is shuffled.

**Code under test**
```ts
// locale.ts
let current = 'de';                        // BUG: the default locale must be 'en'
export const getLocale = () => current;
export const setLocale = (l: string) => { current = l; };
```

**Bad test**
```ts
import { it, expect } from 'vitest';
import { getLocale, setLocale } from './locale';

it('switches the locale', () => {
  setLocale('en');
  expect(getLocale()).toBe('en');
});

it('defaults to English', () => {
  expect(getLocale()).toBe('en');          // passes only because the test above left 'en' behind
});
```

**Bug it lets through:** every new user gets German. The suite runs its
tests in file order, so the "default" test always runs after the switch.

**Correct test**
```ts
import { it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => { vi.resetModules(); });
const freshLocale = () => import('./locale');   // a new module instance per test

it('switches the locale', async () => {
  const { getLocale, setLocale } = await freshLocale();
  setLocale('fr');
  expect(getLocale()).toBe('fr');
});

it('defaults to English', async () => {
  const { getLocale } = await freshLocale();
  expect(getLocale()).toBe('en');
});
```
**Fails because:** each test imports a freshly evaluated module, so the
default test sees the module's real starting value, `'de'`, and goes red.
The switch test also uses `'fr'`, so it could not mask the default even
without the reset. Nothing is faked; the module's own initial state must
stay real, because that is where the bug is.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** every test builds or resets the state it reads. Run the suite in
shuffled order (for example `--sequence.shuffle`) and each test alone to
prove no test depends on another.

**When it doesn't apply:** not applicable when the unit holds no state
between calls (pure functions, or state created per call), because there is
nothing for one test to leave behind.

**Other forms:**
- An in-memory "database" module shared by every test in a file, where a
  "list is empty at start" test passes only because it runs first.
- Backend / CLI / DB: tests share one database without a per-test
  transaction rollback or truncate, so a "creates a user" test passes because
  an earlier test already inserted the row.

### F7.6 — Leaked spies, mocks or globals

*A test replaces something (a spy, a stub, a global, an env var, fake
timers) and never restores it, so a later test runs against the replacement
and passes. (State kept by the code under test itself is F7.5.)*

**Contract:** the new checkout is on by default.

**How to spot it:** `vi.spyOn`, `vi.stubGlobal`, `vi.useFakeTimers` or a
direct assignment to `process.env` or a module object, with no matching
`restoreAllMocks`, `unstubAllGlobals`, `useRealTimers` or restore in an
`afterEach`, and no restore option set in the runner config.

**Code under test**
```ts
// flags.ts
const DEFAULTS: Record<string, boolean> = { newCheckout: false };   // BUG: newCheckout must default to true
export const flags = {
  isEnabled: (name: string): boolean => DEFAULTS[name] ?? false,
};

// checkout.ts
import { flags } from './flags';
export const checkoutVariant = () => (flags.isEnabled('newCheckout') ? 'new' : 'classic');
```

**Bad test**
```ts
import { it, expect, vi } from 'vitest';
import { flags } from './flags';
import { checkoutVariant } from './checkout';

it('shows the new checkout when the flag is on', () => {
  vi.spyOn(flags, 'isEnabled').mockReturnValue(true);     // never restored
  expect(checkoutVariant()).toBe('new');
});

it('uses the new checkout by default', () => {
  expect(checkoutVariant()).toBe('new');                   // still sees the spy from the test above
});
```

**Bug it lets through:** every user gets the classic checkout. With the
runner's default settings (no automatic restore between tests), the default
test runs against the first test's spy, which still returns `true`.

**Correct test**
```ts
import { it, expect, vi, afterEach } from 'vitest';
import { flags } from './flags';
import { checkoutVariant } from './checkout';

afterEach(() => { vi.restoreAllMocks(); });

it('shows the new checkout when the flag is on', () => {
  vi.spyOn(flags, 'isEnabled').mockReturnValue(true);
  expect(checkoutVariant()).toBe('new');
});

it('uses the new checkout by default', () => {
  expect(checkoutVariant()).toBe('new');
});
```
**Fails because:** `restoreAllMocks` puts the real `isEnabled` back after the
first test, so the default test reads the real `DEFAULTS` and gets
`'classic'`. The spy is fine inside the test that owns it; it must not
outlive that test.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** restore every replacement in the test or hook that made it, or
turn on the runner's automatic restore (`restoreMocks`, `unstubGlobals`,
`unstubEnvs`).

**When it doesn't apply:** not applicable when the replacement is
file-scoped by design (a module mock declared once for the whole file), and
no test in that file needs the real implementation, because nothing then
runs against a replacement it did not ask for.

**Other forms:**
- `vi.useFakeTimers()` in one test leaves later tests on a frozen clock.
- `vi.stubGlobal('fetch', …)` without `vi.unstubAllGlobals()` makes later
  "network error" tests pass against the stub.
- Backend / CLI / DB: in Python, assigning `module.client = FakeClient()`
  directly instead of through `monkeypatch`, which restores automatically.

### F7.7 — Unpinned clock or random source

*The unit reads the real clock or an unseeded random source, and the test
does not pin it, so the test only ever checks the moment or value it happens
to run with, not the one that shows the bug. Pinning the clock or the
generator, with the same assertions, is what turns it red. (Ordering and
overlap are F7.1; other machine state is F7.2; a case that no test checks at
all is F6.2.)*

**Contract:** a yearly plan renews in the same calendar month next year (a
plan bought on 29 February renews on 28 February).

**How to spot it:** the test computes inputs from `Date.now()`,
`new Date()` or `Math.random()` at run time, with no fake clock and no
injected or seeded generator.

**Code under test**
```ts
export function renewalDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate()));  // BUG: 29 Feb rolls over to 1 Mar
}
```

**Bad test**
```ts
import { it, expect } from 'vitest';

it('renews in the same month next year', () => {
  const now = new Date();                  // whatever day the suite runs on
  const renewal = renewalDate();
  expect(renewal.getUTCFullYear()).toBe(now.getUTCFullYear() + 1);
  expect(renewal.getUTCMonth()).toBe(now.getUTCMonth());
});
```

**Bug it lets through:** plans bought on 29 February renew on 1 March, in
the wrong month. The bad test checks only the day the suite runs on, and
every other day of the year exists again next year.

**Correct test**
```ts
import { it, expect, vi, afterEach } from 'vitest';

afterEach(() => { vi.useRealTimers(); });

it('renews in the same month next year', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.UTC(2028, 1, 29, 12)));   // 29 Feb: the day with no twin next year
  const now = new Date();
  const renewal = renewalDate();
  expect(renewal.getUTCFullYear()).toBe(now.getUTCFullYear() + 1);
  expect(renewal.getUTCMonth()).toBe(now.getUTCMonth());
});
```
**Fails because:** the only change from the bad test is the pinned clock.
On 29 February 2028, `Date.UTC(2029, 1, 29)` rolls over to 1 March 2029, so
the month assertion gets 2 (March) instead of 1 (February). With the day
clamped to the month's last day (`Math.min(day, lastDayOfMonth)`) it returns
28 February 2029 and passes on any date. The clock is safe (and necessary)
to fake; the date arithmetic in `renewalDate` must stay real.

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** pin time with a fake clock or an injected `now`, and randomness
with an injected or seeded generator, then test the exact boundary values.

**When it doesn't apply:** not applicable when the unit reads no clock and no
random source, because there is nothing to pin.

**Other forms:**
- `pick(items)` uses `Math.random()`, and an off-by-one never picks the last
  item; a test asserting "the result is one of the items" passes. Inject the
  generator and test its extreme values (0 and just under 1).
- A "Today" label is tested only at the time the suite happens to run, so a
  timezone bug near midnight passes. Pin the time and the timezone.
- Backend / CLI / DB: a query uses the database's `NOW()` while fixtures use
  the test process's clock; in Python, `datetime.now()` is called directly
  instead of through an injected clock.

---

## Watch List

Audit labels are legacy auditor codes, routed per finding. A label may
appear on several entries when its findings had different mechanisms; cite
the entry that matches the finding's mechanism, not the label.

These rows are candidate observations taken from audit findings. They have
not yet been mutation-verified against real code: nobody has yet shown a
one-line source edit that the test lets through. Each becomes a full entry
(with the complete shape) once that is shown. Until then, cite the W-number.

| ID | Shape | Audit labels |
|---|---|---|
| W1 | **Fallback masks the failure of a required primary path:** the contract independently requires the primary path (the owner's template renders the page; the normal cleanup runs when the animation ends), but a fallback produces the same visible success (a generic renderer, a backstop timer), so the test passes with the primary path broken. The fallback's success alone violates the contract, because the primary path is itself promised: its output is lost (the owner's template) or its timing is part of the spec (cleanup at animation end, not seconds later). Assert something only the primary path produces, and test the fallback separately with the primary path disabled. | FALLBACK-MASKS-FAILURE, FALLBACK-HIDES-BUG |
| W2 | **An expected-failure marker accepts any failure**, not the specific defect, so a new regression hides behind it. | EXPECTED-FAIL-MASKS-ERROR, EXPECTED-FAIL-MASKS-REGRESSION |
| W4 | **Stale target (retired subject):** the test drives a UI path or component that production no longer uses (a removed tab, a deleted shell), so it passes while the live path is untested. (A stale *expected value* is F4.6.) | OBSOLETE-TARGET |
| W6 | **Invalid fixture:** the fixture is invalid for the domain and loose assertions accept the result. Two kinds: *type-invalid* (a required field is missing or misnamed, such as `priceFormatted` instead of the required numeric `price`), which a type-checked fixture would reject; and *domain-invalid* (the field is present and well-typed but meaningless, such as `price: NaN`, which is a valid TypeScript `number`), which only a domain check rejects. | INVALID-FIXTURE |

Retired IDs (kept so older findings still resolve; never reused):
- W3 (sampling misses the failure): merged into F5.1 (sampled-away frames;
  F5.1's note marks the F5.2 boundary) and F7.1 (fixed read window).
- W5 (expected shape omits a real field): merged into F4.6.
- W7 (false comment): dropped; see F6.1 and F7.1.

Not catalog classes:
- TEST-LOAD-FAIL: the reported load failure was re-run and does not
  reproduce: the file loads and all its tests pass, so it is not a catalog
  class.

---

## Adding a New Entry

- **Where it goes:**
  - A new instance of an existing entry's mechanism goes on that entry's
    "Other forms" line, with its label added to "Audit labels".
  - A genuinely new mechanism becomes a full entry when you can write a
    real example: a bad test that passes on the bug and a correct test that
    fails on it. Otherwise it starts as a watch-list row, and is promoted
    once that is shown.
  - A new full entry goes at the end of the matching family with the next
    free number.
  - A new label, or a legacy label whose findings have different mechanisms,
    is routed per finding: list it on each entry whose mechanism one of its
    findings shows.
- **Numbering:** never renumber existing entries or watch-list rows, and
  never reuse a retired W ID, because findings cite them by ID. A promoted or
  merged watch-list row keeps its W ID under "Retired IDs" with a pointer to
  its new home.
- **Overlap:** before adding an entry, check that its italic first line
  separates it from every neighbour. If it doesn't, it is an "other form",
  not a new entry.
- **Keep it generic:** strip product names and use neutral nouns (site,
  widget, user, document). Include no counts or rankings.


````markdown
### F<family>.<n> — <short name of the mistake>

*<one line saying how to tell this apart from its neighbours>*

**Contract:** <one line: the observable behaviour the test must protect>

**How to spot it:** <one line: what this mistake looks like when reading a test>

**Code under test**
```<lang>
<the smallest code, with exactly one bug marked // BUG:>
```

**Bad test**
```<lang>
<a self-contained test that stays green while that bug ships>
```

**Bug it lets through:** <what the user sees>

**Correct test**
```<lang>
<the smallest self-contained test that fails on that bug>
```
**Fails because:** <why it goes red on the bug; what is safe to fake; what must stay real>

**Verify:** the bad test passes on the buggy code; the correct test fails on it and passes after the fix (revert the fix → red).

**Rule:** <one or two sentences to carry forward>

**When it doesn't apply:** <not applicable when …, because …>

**Other forms:** <optional; include a backend / CLI / DB line if the main example is UI-specific>

**Audit labels:** <optional; omit the line when the entry has none>
````
