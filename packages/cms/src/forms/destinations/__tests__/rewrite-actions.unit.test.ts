import assert from "node:assert/strict";
import { test } from "vitest";

import { assertSubmitUrl, rewriteFormActions } from "../rewrite-actions.js";

/** @file Exported pages post to an external receiver: only the host's exact form actions change. */

test("only exact /forms/<slug>/submit actions in .html files are rewritten", () => {
  const page = '<form action="/forms/wait-list_2/submit"><form action="/contact"><form action="https://x.example/forms/a/submit"><a href="/forms/a/submit">';
  const files = [
    { file: "index.html", data: page },
    { file: "about/INDEX.HTML", data: Buffer.from('<form method="post" action="/forms/host/submit">') },
    { file: "app.js", data: 'fetch("/forms/a/submit"); x = \'action="/forms/a/submit"\'' },
    { file: "plain.html", data: "<p>no forms</p>" },
  ];
  const out = rewriteFormActions({ files, submitUrl: "https://relay.example/base/" });
  assert.equal(out[0]!.data, '<form action="https://relay.example/base/forms/wait-list_2/submit"><form action="/contact"><form action="https://x.example/forms/a/submit"><a href="/forms/a/submit">');
  assert.ok(Buffer.isBuffer(out[1]!.data));
  assert.equal(out[1]!.data.toString(), '<form method="post" action="https://relay.example/base/forms/host/submit">');
  assert.equal(out[2], files[2], "non-HTML files are untouched");
  assert.equal(out[3], files[3], "an unchanged page keeps its object");
  assert.equal(files[0]!.data, page, "the input is not mutated");
});

test("the post address is attribute-escaped", () => {
  const out = rewriteFormActions({ files: [{ file: "a.html", data: '<form action="/forms/a/submit">' }], submitUrl: "https://relay.example/a&b" });
  assert.equal(out[0]!.data, '<form action="https://relay.example/a&amp;b/forms/a/submit">');
});

test("a submit address must be plain https: no http, userinfo, query or fragment", () => {
  assert.equal(assertSubmitUrl({ submitUrl: "https://Relay.Example" }), "https://relay.example");
  assert.equal(assertSubmitUrl({ submitUrl: "https://relay.example/in//" }), "https://relay.example/in");
  for (const submitUrl of ["http://relay.example", "https://user:pw@relay.example", "https://relay.example/?a=1", "https://relay.example/?", "https://relay.example/#x", "https://relay.example/#", "not a url", "javascript:alert(1)"]) {
    assert.throws(() => assertSubmitUrl({ submitUrl }), /not a plain https URL \(no user name, query or fragment\)\. Update or reinstall the destination's plugin, then publish again/, submitUrl);
  }
  assert.throws(() => rewriteFormActions({ files: [], submitUrl: "http://relay.example" }), /not a plain https URL/);
});
