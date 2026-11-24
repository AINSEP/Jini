import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ACTIVE_CONTEXT_TTL_MS } from '../active-context.js';
import { createRunActiveContextStore, type RunActiveScreen } from '../run-active-context.js';

// Moved from the host's run-active-context STORE tests; the host keeps its wire test of the mounted route.
type PageContext = RunActiveScreen & { readonly section: string; readonly view?: string; readonly entry?: RunActiveScreen['entry'] & { readonly slug?: string; readonly status?: string } };

const PAGE_EDITOR: PageContext = {
  path: "/pages/7b42dba9",
  section: "pages",
  view: "page-editor",
  entry: { kind: "page", id: "7b42dba9", title: "Landing sample", slug: "landing", status: "draft" },
};
const MEDIA_INDEX: PageContext = { path: "/media", section: "media" };

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return { now: () => current, advance: (ms) => (current += ms) };
}

test("STORE: nothing recorded reads as inactive", () => {
  assert.deepEqual(createRunActiveContextStore().read(), { active: false });
});

test("STORE: a live run's screen is the active resource, its entry id the resourceRef", () => {
  const time = clock();
  const store = createRunActiveContextStore({ now: time.now });
  store.record({ runId: "run-1", pageContext: PAGE_EDITOR });
  time.advance(250);

  assert.deepEqual(store.read(), {
    active: true,
    resourceRef: "7b42dba9",
    resourceName: "Landing sample",
    detail: "/pages/7b42dba9",
    ts: 1_000_000,
    ageMs: 250,
    pageContext: PAGE_EDITOR,
  });
});

test("STORE: a screen with no open entry uses its path as the resourceRef and has no name", () => {
  const store = createRunActiveContextStore({ now: () => 5 });
  store.record({ runId: "run-1", pageContext: MEDIA_INDEX });

  assert.deepEqual(store.read(), {
    active: true,
    resourceRef: "/media",
    resourceName: null,
    detail: "/media",
    ts: 5,
    ageMs: 0,
    pageContext: MEDIA_INDEX,
  });
});

test("STORE: a finished run's screen is forgotten", () => {
  const store = createRunActiveContextStore();
  store.record({ runId: "run-1", pageContext: PAGE_EDITOR });
  store.forget({ runId: "run-1" });

  assert.deepEqual(store.read(), { active: false });
});

test("STORE: a screen older than http-kit's active-context TTL reads as inactive", () => {
  const time = clock();
  const store = createRunActiveContextStore({ now: time.now });
  store.record({ runId: "run-1", pageContext: PAGE_EDITOR });

  time.advance(ACTIVE_CONTEXT_TTL_MS);
  assert.equal(store.read().active, true);
  time.advance(1);
  assert.deepEqual(store.read(), { active: false });
});

test("STORE: two live runs on DIFFERENT screens are ambiguous — inactive, never the wrong screen", () => {
  const store = createRunActiveContextStore();
  store.record({ runId: "run-1", pageContext: PAGE_EDITOR });
  store.record({ runId: "run-2", pageContext: MEDIA_INDEX });

  assert.deepEqual(store.read(), { active: false });
});

test("STORE: two live runs on the SAME screen agree, and the newer recording wins", () => {
  const time = clock();
  const store = createRunActiveContextStore({ now: time.now });
  store.record({ runId: "run-1", pageContext: PAGE_EDITOR });
  time.advance(100);
  store.record({ runId: "run-2", pageContext: { ...PAGE_EDITOR, entry: { ...PAGE_EDITOR.entry!, title: "Landing sample (renamed)" } } });

  const answer = store.read();
  assert.equal(answer.active, true);
  if (!answer.active) return;
  assert.equal(answer.resourceName, "Landing sample (renamed)");
  assert.equal(answer.ts, 1_000_100);
});

test("STORE: a stale run on another screen does not make a fresh one ambiguous", () => {
  const time = clock();
  const store = createRunActiveContextStore({ now: time.now });
  store.record({ runId: "run-old", pageContext: MEDIA_INDEX });
  time.advance(ACTIVE_CONTEXT_TTL_MS + 1);
  store.record({ runId: "run-new", pageContext: PAGE_EDITOR });

  const answer = store.read();
  assert.equal(answer.active, true);
  if (answer.active) assert.equal(answer.resourceRef, "7b42dba9");
});

test("STORE: a screen exactly at the TTL is still live", () => {
  const time = clock();
  const store = createRunActiveContextStore({ now: time.now });
  store.record({ runId: "run-1", pageContext: MEDIA_INDEX });
  time.advance(ACTIVE_CONTEXT_TTL_MS);

  assert.equal(store.read().active, true);
});

test("STORE: equal recording times resolve to the run recorded last", () => {
  const store = createRunActiveContextStore({ now: () => 7 });
  store.record({ runId: "run-1", pageContext: PAGE_EDITOR });
  store.record({ runId: "run-2", pageContext: { ...PAGE_EDITOR, entry: { ...PAGE_EDITOR.entry!, title: "Second" } } });

  const answer = store.read();
  assert.equal(answer.active && answer.resourceName, "Second");
});

test("STORE: the newest recording wins even when an older run re-records later in map order", () => {
  const time = clock();
  const store = createRunActiveContextStore({ now: time.now });
  store.record({ runId: "run-a", pageContext: PAGE_EDITOR });
  time.advance(10);
  store.record({ runId: "run-b", pageContext: PAGE_EDITOR });
  time.advance(10);
  store.record({ runId: "run-a", pageContext: { ...PAGE_EDITOR, entry: { ...PAGE_EDITOR.entry!, title: "Newest" } } });

  const answer = store.read();
  assert.equal(answer.active && answer.resourceName, "Newest");
});

test("STORE: the same path with a different open entry is a different screen", () => {
  const store = createRunActiveContextStore();
  store.record({ runId: "run-1", pageContext: PAGE_EDITOR });
  store.record({ runId: "run-2", pageContext: { ...PAGE_EDITOR, entry: { ...PAGE_EDITOR.entry!, id: "other-id" } } });

  assert.deepEqual(store.read(), { active: false });
});
