import { describe, expect, test } from "vitest";

import { applyEdit } from "../../core/apply.js";
import { createEditHistory } from "../../core/history.js";
import {
  createHtmlRegionTarget,
  isValidRegionHandle,
  type HtmlRegionParser,
  type ParsedRegion,
} from "../regions.js";

/**
 * A deliberately small stand-in for a real HTML parser: it assumes regions are non-nested and
 * closed by the next matching end tag. That is enough to exercise every rule in `regions.ts`, and
 * being a TEST FIXTURE is exactly why it may make assumptions a production parser must not — the
 * module under test never parses anything itself, which is the point of injecting the parser.
 */
function makeParser(options?: { readonly wellFormed?: (html: string) => boolean }): HtmlRegionParser {
  const parser: HtmlRegionParser = {
    findRegions(html: string): readonly ParsedRegion[] {
      const regions: ParsedRegion[] = [];
      const openTag = /<([a-z0-9]+)\b([^>]*)>/gi;
      let match: RegExpExecArray | null;
      while ((match = openTag.exec(html)) !== null) {
        const [full, tag = "", attrs = ""] = match;
        const handle = /\bdata-agent-element="([^"]*)"/.exec(attrs)?.[1];
        if (handle === undefined) continue;
        const innerStart = match.index + full.length;
        const closeIndex = html.indexOf(`</${tag}>`, innerStart);
        if (closeIndex === -1) continue;
        const role = /\bdata-agent-role="([^"]*)"/.exec(attrs)?.[1];
        const label = /\bdata-agent-label="([^"]*)"/.exec(attrs)?.[1];
        regions.push({
          handle,
          innerStart,
          innerEnd: closeIndex,
          ...(role === undefined ? {} : { role }),
          ...(label === undefined ? {} : { label }),
        });
      }
      return regions;
    },
  };
  if (options?.wellFormed) {
    return {
      ...parser,
      checkWellFormed: (html) =>
        options.wellFormed?.(html) === false
          ? { ok: false, reason: "unclosed <section> — the document no longer parses" }
          : { ok: true },
    };
  }
  return parser;
}

/** An in-memory document store, exposing the raw HTML so tests can assert on bytes. */
function makeStore(initial: string): { read: () => Promise<string>; write: (h: string) => Promise<void>; html: () => string } {
  let html = initial;
  return {
    read: async () => html,
    write: async (next) => {
      html = next;
    },
    html: () => html,
  };
}

const DOC = [
  "<!doctype html>",
  '<html><body class="page">',
  '  <section data-agent-element="hero" data-agent-role="region" data-agent-label="Hero">OLD HERO</section>',
  "  <!-- a comment the author cares about -->",
  '  <section data-agent-element="pricing" data-agent-role="region">OLD PRICING</section>',
  "</body></html>",
].join("\n");

function setup(html = DOC, parser = makeParser()) {
  const store = makeStore(html);
  return { store, target: createHtmlRegionTarget({ store, parser }) };
}

describe("addressing", () => {
  test("listParts publishes each tagged region with its role and label", async () => {
    const { target } = setup();

    expect(await target.listParts()).toEqual([
      { id: "hero", kind: "region", label: "Hero" },
      { id: "pricing", kind: "region" },
    ]);
  });

  test("readPart returns only the region's inner content", async () => {
    const { target } = setup();

    expect(await target.readPart("hero")).toBe("OLD HERO");
    expect(await target.readPart("pricing")).toBe("OLD PRICING");
  });

  test("an unlisted id is unreadable — the allowlist is structural, not advisory", async () => {
    const { target } = setup();

    await expect(target.readPart("footer")).rejects.toThrow(/no region is tagged/);
  });

  test("a handle appearing twice is refused as ambiguous rather than resolved to the first", async () => {
    const doc = '<div data-agent-element="dup">A</div><div data-agent-element="dup">B</div>';
    const { target } = setup(doc);

    await expect(target.readPart("dup")).rejects.toThrow(/must identify exactly one region/);
    // ...and it is never published in the first place.
    expect(await target.listParts()).toEqual([{ id: "dup" }]);
  });

  test("a handle violating the agentic grammar is never published", async () => {
    const { target } = setup('<div data-agent-element="Not Valid!">x</div>');

    expect(await target.listParts()).toEqual([]);
  });

  test("isValidRegionHandle matches the agentic handle grammar", () => {
    expect(isValidRegionHandle("hero")).toBe(true);
    expect(isValidRegionHandle("hero-section-2")).toBe(true);
    expect(isValidRegionHandle("Hero")).toBe(false);
    expect(isValidRegionHandle("hero--x")).toBe(false);
    expect(isValidRegionHandle('a"]')).toBe(false);
    expect(isValidRegionHandle("")).toBe(false);
    expect(isValidRegionHandle("a".repeat(129))).toBe(false);
  });
});

describe("writes preserve every byte outside the edited region", () => {
  test("a doctype, an attribute and an author's comment all survive an edit", async () => {
    const { store, target } = setup();

    await target.replacePart("hero", "<h1>NEW</h1>");

    const html = store.html();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<body class="page">');
    expect(html).toContain("<!-- a comment the author cares about -->");
    expect(html).toContain('data-agent-label="Hero"');
    expect(html).toContain("OLD PRICING");
    expect(html).toContain("<h1>NEW</h1>");
    expect(html).not.toContain("OLD HERO");
  });

  test("a region that does not exist is NOT created — unlike the port's general upsert contract", async () => {
    const { store, target } = setup();
    const before = store.html();

    await expect(target.replacePart("nope", "x")).rejects.toThrow(/no region is tagged/);
    expect(store.html()).toBe(before);
  });
});

describe("validate — the allowlist cannot be extended by the model", () => {
  test("content that invents a new data-agent-element handle is REJECTED", async () => {
    const { store, target } = setup();

    const outcome = await applyEdit(target, {
      id: "hero",
      content: '<div data-agent-element="smuggled">mine now</div>',
    });

    expect(outcome.status).toBe("rejected");
    expect(outcome.status === "rejected" && outcome.reason).toMatch(/adds data-agent-element handles/);
    expect(outcome.status === "rejected" && outcome.reason).toMatch(/smuggled/);
    // Nothing was written, so the next listParts cannot publish it.
    expect(store.html()).toContain("OLD HERO");
    expect(await target.listParts()).toEqual([
      { id: "hero", kind: "region", label: "Hero" },
      { id: "pricing", kind: "region" },
    ]);
  });

  test("content that DELETES a NESTED region's handle is rejected", async () => {
    // Deletion is only reachable when one region contains another: a splice is bounded by the
    // edited region's inner range, so a SIBLING's opening tag is out of reach by construction
    // (see the test below). A nested region is inside that range, and rewriting the parent would
    // silently drop the child from the allowlist.
    const nested = [
      '<section data-agent-element="hero">',
      '  <div data-agent-element="cta">Buy now</div>',
      "</section>",
    ].join("\n");
    const { target } = setup(nested);

    expect((await target.listParts()).map((p) => p.id)).toEqual(["hero", "cta"]);

    const outcome = await applyEdit(target, { id: "hero", content: "<p>no more call to action</p>" });

    expect(outcome.status).toBe("rejected");
    expect(outcome.status === "rejected" && outcome.reason).toMatch(/removes existing/);
    expect(outcome.status === "rejected" && outcome.reason).toMatch(/cta/);
  });

  test("a SIBLING region cannot be deleted at all — a splice is bounded by the edited region", async () => {
    const { store, target } = setup();

    // Even a deliberate attempt to close out early and swallow the next region only ever writes
    // between hero's own tags; pricing's opening tag is outside the spliced range.
    const outcome = await applyEdit(target, {
      id: "hero",
      content: "</section><section>trying to swallow pricing",
    });

    expect(outcome).toEqual({ status: "applied", id: "hero" });
    expect(store.html()).toContain('data-agent-element="pricing"');
    expect(await target.readPart("pricing")).toBe("OLD PRICING");
  });

  test("content that DUPLICATES an existing handle is rejected", async () => {
    const { target } = setup();

    const outcome = await applyEdit(target, {
      id: "hero",
      content: '<div data-agent-element="pricing">a second one</div>',
    });

    expect(outcome.status).toBe("rejected");
    expect(outcome.status === "rejected" && outcome.reason).toMatch(/how many times/);
  });

  test("an ordinary edit that touches no handles is accepted", async () => {
    const { store, target } = setup();

    const outcome = await applyEdit(target, { id: "hero", content: "<h1>Welcome</h1><p>Hi.</p>" });

    expect(outcome).toEqual({ status: "applied", id: "hero" });
    expect(store.html()).toContain("<h1>Welcome</h1><p>Hi.</p>");
  });
});

describe("validate — whole-document and size rules", () => {
  test("the parser's structural verdict is judged on the PROSPECTIVE document, not the fragment", async () => {
    let sawProspective = "";
    const parser = makeParser();
    const target = createHtmlRegionTarget({
      store: makeStore(DOC),
      parser: {
        findRegions: parser.findRegions,
        checkWellFormed: (html) => {
          sawProspective = html;
          return { ok: true };
        },
      },
    });

    await applyEdit(target, { id: "hero", content: "NEW" });

    // The whole document, with the edit spliced in — not the fragment alone.
    expect(sawProspective).toContain("<!doctype html>");
    expect(sawProspective).toContain("NEW");
    expect(sawProspective).toContain("OLD PRICING");
  });

  test("a structural rejection carries the parser's reason through to the model", async () => {
    const { target } = setup(DOC, makeParser({ wellFormed: (html) => !html.includes("BROKEN") }));

    const outcome = await applyEdit(target, { id: "hero", content: "BROKEN" });

    expect(outcome).toEqual({
      status: "rejected",
      id: "hero",
      reason: "unclosed <section> — the document no longer parses",
    });
  });

  test("an oversized region body is rejected before anything is parsed or written", async () => {
    const store = makeStore(DOC);
    const target = createHtmlRegionTarget({
      store,
      parser: makeParser(),
      options: { maxPartLength: 32 },
    });

    const outcome = await applyEdit(target, { id: "hero", content: "x".repeat(33) });

    expect(outcome.status).toBe("rejected");
    expect(outcome.status === "rejected" && outcome.reason).toMatch(/over the 32-character limit/);
    expect(store.html()).toContain("OLD HERO");
  });
});

describe("snapshot and restore", () => {
  test("restore puts every region back after edits of DIFFERENT lengths", async () => {
    const { store, target } = setup();
    const snapshot = await target.snapshot();

    // Both regions change length, which shifts the offsets of everything after them. Resolving all
    // offsets once up front is the obvious implementation and it corrupts the document here.
    await target.replacePart("hero", "a much, much longer hero than before");
    await target.replacePart("pricing", "x");

    await target.restore(snapshot);

    expect(await target.readPart("hero")).toBe("OLD HERO");
    expect(await target.readPart("pricing")).toBe("OLD PRICING");
    expect(store.html()).toContain("<!-- a comment the author cares about -->");
  });

  test("snapshot captures only valid, unambiguous regions", async () => {
    const { target } = setup();

    expect((await target.snapshot()).parts).toEqual({ hero: "OLD HERO", pricing: "OLD PRICING" });
  });
});

describe("composes with the rest of the package", () => {
  test("undo restores a region through the history tier", async () => {
    const { store, target } = setup();
    const history = createEditHistory(target);

    await history.transaction((recording) => applyEdit(recording, { id: "hero", content: "NEW HERO" }));
    expect(store.html()).toContain("NEW HERO");

    await history.undo();

    expect(await target.readPart("hero")).toBe("OLD HERO");
    expect(store.html()).toContain("OLD PRICING");
  });
});
