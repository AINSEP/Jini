import assert from "node:assert/strict";
import { test } from "vitest";
import { MAX_CONTENT_EMBED_DEPTH, MAX_CONTENT_EMBED_FETCHES, resolveHtmlFormatContentMarkers, type ContentMarkerPorts, type ContentMarkerRef } from "../content-markers.js";

const selfMarker = '<div data-embed-config=\'{"type":"content","id":"a"}\'></div>';

test("the depth bound terminates self references with a fixed fetch count", async () => {
  let calls = 0;
  const budget = { remaining: MAX_CONTENT_EMBED_FETCHES };
  const ports: ContentMarkerPorts = {
    readPublishedHtml: async () => { calls += 1; return selfMarker; },
    renderEmbeds: async ({ html }) => html,
  };
  const result = await resolveHtmlFormatContentMarkers({ ports, html: '<main data-embed-config=\'{"type":"content","id":"a"}\'></main>', depth: 0, budget });
  assert.equal(calls, MAX_CONTENT_EMBED_DEPTH);
  assert.equal(budget.remaining, MAX_CONTENT_EMBED_FETCHES - MAX_CONTENT_EMBED_DEPTH);
  assert.equal(result, '<main>' + '<div>'.repeat(MAX_CONTENT_EMBED_DEPTH - 1) + selfMarker + '</div>'.repeat(MAX_CONTENT_EMBED_DEPTH - 1) + '</main>');
});

test("nested branches reserve their slices from one caller-owned budget", async () => {
  const bodies = new Map<string, string>();
  let html = "";
  for (let branch = 0; branch < 2; branch++) {
    let body = "";
    for (let leaf = 0; leaf < 40; leaf++) {
      const id = `branch-${branch}-leaf-${leaf}`;
      bodies.set(id, `<p>${id}</p>`);
      body += `<div data-embed-config='{"type":"content","id":"${id}"}'></div>`;
    }
    bodies.set(`branch-${branch}`, body);
    html += `<section data-embed-config='{"type":"content","id":"branch-${branch}"}'></section>`;
  }
  const budget = { remaining: MAX_CONTENT_EMBED_FETCHES };
  const reads: string[] = [];
  const ports: ContentMarkerPorts = {
    readPublishedHtml: async ({ ref }) => { reads.push(ref.key); return bodies.get(ref.key); },
    renderEmbeds: async ({ html }) => html,
  };
  const result = await resolveHtmlFormatContentMarkers({ ports, html, depth: 0, budget });
  assert.equal(budget.remaining, 0);
  assert.equal(reads.length, MAX_CONTENT_EMBED_FETCHES);
  assert.deepEqual(reads.slice(0, 2), ["branch-0", "branch-1"]);
  assert.equal((result.match(/<p>branch-\d-leaf-\d+<\/p>/g) ?? []).length, MAX_CONTENT_EMBED_FETCHES - 2);
  assert.equal((result.match(/data-embed-config/g) ?? []).length, 80 - (MAX_CONTENT_EMBED_FETCHES - 2));
});

test("deduplication happens before reads and retains the first occurrence's reference", async () => {
  const reads: ContentMarkerRef[] = [];
  const ports: ContentMarkerPorts = {
    readPublishedHtml: async ({ ref }) => { reads.push(ref); return `<p>${ref.by}</p>`; },
    renderEmbeds: async ({ html }) => html,
  };
  const result = await resolveHtmlFormatContentMarkers({ ports, html:
    '<div data-embed-config=\'{"type":"content","slug":"same"}\'></div>' +
    '<section data-embed-config=\'{"type":"content","id":"same"}\'></section>' +
    '<div data-embed-config=\'{"type":"content","id":"next"}\'></div>', depth: 0, budget: { remaining: 3 } });
  assert.deepEqual(reads, [{ key: "same", by: "slug", slug: "same" }, { key: "next", by: "id", id: "next" }]);
  assert.equal(result, '<div><p>slug</p></div><section><p>slug</p></section><div><p>id</p></div>');
});

test("pending overrides match slug-only refs while an authored id remains authoritative", async () => {
  const reads: ContentMarkerRef[] = [];
  const ports: ContentMarkerPorts = {
    readPublishedHtml: async ({ ref }) => { reads.push(ref); return "<p>Row B</p>"; },
    renderEmbeds: async ({ html }) => html,
  };
  const result = await resolveHtmlFormatContentMarkers({ ports, html:
    '<main data-embed-config=\'{"type":"content","id":"b","slug":"our-story"}\'></main>' +
    '<section data-embed-config=\'{"type":"content","slug":"our-story"}\'></section>', depth: 0, budget: { remaining: 5 } },
    { pendingHtmlOverride: { id: "a", slug: "our-story", bodyHtml: "<p>Pending A</p>" } });
  assert.deepEqual(reads, [{ key: "b", by: "id", id: "b" }]);
  assert.equal(result, "<main><p>Row B</p></main><section><p>Pending A</p></section>");
});

test("a pending root referring to itself uses the stored body for its child", async () => {
  const reads: ContentMarkerRef[] = [];
  const rendered: string[] = [];
  const ports: ContentMarkerPorts = {
    readPublishedHtml: async ({ ref }) => { reads.push(ref); return "<p>Stored bytes</p>"; },
    renderEmbeds: async ({ html }) => { rendered.push(html); return html; },
  };
  assert.equal(await resolveHtmlFormatContentMarkers({ ports, html: '<main data-embed-config=\'{"type":"content","id":"a"}\'></main>', depth: 0, budget: { remaining: 10 } },
    { pendingHtmlOverride: { id: "a", slug: "a-slug", bodyHtml: selfMarker } }), '<main><div><p>Stored bytes</p></div></main>');
  assert.deepEqual(reads, [{ key: "a", by: "id", id: "a" }]);
  assert.deepEqual(rendered, ["<p>Stored bytes</p>", "<div><p>Stored bytes</p></div>"]);
});

test("exact splices preserve scripts and styles, finalize attributes and accept an empty body", async () => {
  const body = '<style>p > b { color: red; }</style><script>window.x="<&";</script><p>Body &amp; copy</p>';
  const ports: ContentMarkerPorts = {
    readPublishedHtml: async ({ ref }) => ref.key === "a" ? body : ref.key === "empty" ? "" : undefined,
    renderEmbeds: async ({ html }) => html,
  };
  const missing = '<div data-embed-config=\'{"type":"content","id":"missing"}\'>fallback</div>';
  const other = '<nav data-embed-config=\'{"type":"menu","id":"menu"}\'>authored</nav>';
  assert.equal(await resolveHtmlFormatContentMarkers({ ports, html:
    '<main class="body" data-embed-config=\'{"type":"content","id":"a"}\'>old</main>' +
    '<section data-embed-config=\'{"type":"content","id":"empty"}\'>old</section>' + missing + other,
    depth: 0, budget: { remaining: 10 } }), '<main class="body">' + body + '</main><section></section>' + missing + other);
});
