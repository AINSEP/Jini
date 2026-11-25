import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { skeleton } from "../dna-scaffold.mjs";
import { notesTemplate } from "../init-clone.mjs";

describe("template byte parity", () => {
  it("preserves the complete serialized skeleton, empty lists and final newline", () => {
    expect(Buffer.from(`${JSON.stringify(skeleton({ name: "x" }), null, 2)}\n`)).toEqual(
      readFileSync(new URL("./fixtures/template-skeleton.json", import.meta.url)),
    );
  });

  it("preserves the complete notes output, section boundaries and final newline", () => {
    expect(Buffer.from(notesTemplate({ name: "x", url: "https://source.example.test/template", mode: "visual", level: "L3" }))).toEqual(
      readFileSync(new URL("./fixtures/template-notes.md", import.meta.url)),
    );
  });
});
