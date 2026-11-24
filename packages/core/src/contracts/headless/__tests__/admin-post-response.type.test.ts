import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test } from "vitest";

import type { AdminPost } from "../contracts.js";

/**
 * @file SPEC-047/ADR-056 REQ-3 — compile-time proof that `AdminPost`'s discriminated union makes
 * constructing a TipTap editor's props from an `"html"`-format row a COMPILE ERROR, not a runtime
 * `if` a future refactor could quietly delete or get backwards.
 *
 * `buildTiptapProps` below stands in for the host admin editor component's props contract
 * (its TipTap integration expects a non-null document body) — declared locally rather than
 * imported, because the host admin is a separate TypeScript project that cannot be imported from
 * here, and this test lives beside `AdminPost` itself. The SHAPE below
 * (`bodyJson: Record<string, unknown>`, required, non-null) is the real contract the host admin's
 * own `AdminPost.bodyJson` and its `editor.commands.setContent(post.bodyJson as never)` call rely on.
 *
 * Test runners strip types. The first runtime test therefore uses the TypeScript compiler API to
 * strictly check this file and its imported contract, including the @ts-expect-error directive and
 * the exhaustive switch below, without emitting files.
 */

/** Stand-in for the real TipTap editor's props contract — see this file's header. */
interface TiptapEditorProps {
  bodyJson: Record<string, unknown>;
}

test("REQ-3: strict TypeScript checking enforces this file's error directives and exhaustiveness proofs", () => {
  const program = ts.createProgram([fileURLToPath(import.meta.url)], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    types: ["node"],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
  }));
}, 30_000);

/** Only the `"doc"` branch of `AdminPost` satisfies this — the whole point of the union. */
function buildTiptapProps(post: Extract<AdminPost, { bodyFormat: "doc" }>): TiptapEditorProps {
  return { bodyJson: post.bodyJson };
}

const htmlPost: AdminPost = {
  id: "page-1",
  workspaceId: "ws-1",
  kind: "page",
  title: "About",
  slug: "about",
  status: "published",
  updatedAt: "2026-08-04T00:00:00.000Z",
  version: 3,
  bodyFormat: "html",
  bodyJson: null,
  bodyHtml: "<section data-agent-element=\"hero\">Hi</section>",
};

const docPost: AdminPost = {
  id: "post-1",
  workspaceId: "ws-1",
  kind: "post",
  title: "Hello",
  slug: "hello",
  status: "draft",
  updatedAt: "2026-08-04T00:00:00.000Z",
  version: 1,
  bodyFormat: "doc",
  bodyJson: { type: "doc", content: [] },
  bodyHtml: null,
};

test("REQ-3: constructing Tiptap props from the un-narrowed AdminPost union is a type error — an html-format row must be excluded by the type system, not a forgettable runtime check", () => {
  // @ts-expect-error — `AdminPost` (the full union) is not assignable to the "doc"-only branch
  // `buildTiptapProps` requires; the compiler-API test above validates this directive.
  const props = buildTiptapProps(htmlPost);
  assert.ok(props, "reached at runtime only because the runner strips types — the real assertion is the @ts-expect-error line above");
});

test("REQ-3: narrowing on bodyFormat === 'doc' is what makes the doc branch constructible at all — the union is restrictive, not broken", () => {
  assert.equal(docPost.bodyFormat, "doc");
  if (docPost.bodyFormat === "doc") {
    const props = buildTiptapProps(docPost);
    assert.deepEqual(props.bodyJson, { type: "doc", content: [] });
  } else {
    assert.fail("docPost must narrow to the 'doc' branch");
  }
});

test("REQ-3: exhaustive switch over bodyFormat — a third format value would be a compile error at the 'never' branch below, matching the spec's own exhaustiveness claim", () => {
  function describe(post: AdminPost): string {
    switch (post.bodyFormat) {
      case "doc":
        return `doc:${Object.keys(post.bodyJson).length}`;
      case "html":
        return `html:${post.bodyHtml.length}`;
      default: {
        // If a third `bodyFormat` value is ever added to the union, `post` here is not `never` and
        // this line stops compiling — exactly the protection REQ-3's spec text claims.
        const exhaustive: never = post;
        return exhaustive;
      }
    }
  }

  assert.equal(describe(docPost), "doc:2");
  assert.equal(describe(htmlPost), `html:${htmlPost.bodyHtml!.length}`);
});
