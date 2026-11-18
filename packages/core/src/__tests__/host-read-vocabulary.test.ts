import { expect, it } from "vitest";
import { NEUTRAL_HOST_READ_VOCABULARY, hostReadRef, resolveHostReadRefs, resolveHostReadText, type HostReadVocabulary } from "../host-read-vocabulary.js";

const HOST: HostReadVocabulary = { readRef: ({ entity }) => `host_read.${entity}` };

it("fills every placeholder through the host's vocabulary, deeply, and never mutates the input", () => {
  const catalog = { a: [`see ${hostReadRef({ entity: "redirect" })} or ${hostReadRef({ entity: "seo_entry_meta" })}`], b: 3, c: "plain", d: null };
  expect(resolveHostReadRefs({ value: catalog }, { hostReads: HOST })).toEqual({ a: ["see host_read.redirect or host_read.seo_entry_meta"], b: 3, c: "plain", d: null });
  expect(catalog.a[0]).toContain("{{read:redirect}}");
});

it("names an entity with every underscore spaced out, never a tool id, for a host that binds no vocabulary", () => {
  expect(resolveHostReadText({ text: hostReadRef({ entity: "seo_entry_meta" }) })).toBe("the seo entry meta read tool");
  expect(NEUTRAL_HOST_READ_VOCABULARY.readRef({ entity: "taxonomy" })).toBe("the taxonomy read tool");
});

it("leaves text without a placeholder as it is", () => {
  expect(resolveHostReadText({ text: "plain {read} text" }, { hostReads: HOST })).toBe("plain {read} text");
});
