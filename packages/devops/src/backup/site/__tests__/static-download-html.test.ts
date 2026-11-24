import assert from "node:assert/strict";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { test } from "vitest";
import { downloadDocumentBase, downloadForms, type DownloadHtmlSourceEdits, type Edit, type Element } from "../static-download-html.js";

// A parse5 source-located editor shaped like the host binding: tests exercise the same contract.
const sourceEdits: DownloadHtmlSourceEdits = {
  elements({ html }) {
    const pending: DefaultTreeAdapterMap["node"][] = [parse(html, { sourceCodeLocationInfo: true })];
    const found: Element[] = [];
    while (pending.length) {
      const node = pending.pop()!;
      if ("childNodes" in node) pending.push(...node.childNodes);
      if ("tagName" in node) found.push(node);
      if ("content" in node) pending.push(node.content);
    }
    return found;
  },
  attribute: ({ node, name }) => node.attrs.find(attr => attr.name === name)?.value,
  editedHtml({ html, edits }) {
    const parts: string[] = [];
    let end = html.length;
    for (const edit of [...edits].sort((a: Edit, b: Edit) => b.startOffset - a.startOffset)) { parts.push(html.slice(edit.endOffset, end), edit.text); end = edit.startOffset; }
    parts.push(html.slice(0, end));
    return parts.reverse().join("");
  },
};

test("downloadForms disables a backend form without a GET fallback and reports the removed action", () => {
  const html = '<p><a href="mailto:hi@example.test?subject=x">mail</a></p><form action="/forms/contact/submit" method="post"><input name="q"></form>';
  const result = downloadForms({ html, page: "/contact", sourceEdits });
  assert.match(result.html, /<form  method="dialog">/);
  assert.match(result.html, /<\/form><p>This form needs a server to send messages\. Email us at <a href="mailto:hi@example.test\?subject=x">hi@example.test<\/a> instead\.<\/p>/);
  assert.deepEqual(result.removed, [{ page: "/contact", url: "/forms/contact/submit", attribute: "action", reason: "needs-server" }]);
});

test("downloadForms reports retained sign-in links and leaves external receivers alone", () => {
  const html = '<a href="/signin">Sign in</a><form action="https://receiver.example/send" method="post"></form>';
  const result = downloadForms({ html, page: "/", publicOrigin: "https://site.example", sourceEdits });
  assert.equal(result.html, html);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.serverLinks, [{ page: "/", url: "/signin", attribute: "href", reason: "needs-server" }]);
});

test("downloadDocumentBase drops base elements and rewrites refresh targets", () => {
  const html = '<head><base href="/x/"><meta http-equiv="refresh" content="0; url=/old"></head>';
  assert.equal(downloadDocumentBase({ html, rewrite: url => `.${url}.html`, sourceEdits }), '<head><meta http-equiv="refresh" content="0; url=./old.html"></head>');
});

test("both transforms read and write HTML only through the injected host editor", () => {
  const calls: string[] = [];
  const spy: DownloadHtmlSourceEdits = {
    elements: required => { calls.push("elements"); return sourceEdits.elements(required); },
    attribute: required => sourceEdits.attribute(required),
    editedHtml: () => { calls.push("editedHtml"); return "host-edited"; },
  };
  assert.equal(downloadForms({ html: "<form method=post></form>", page: "/", sourceEdits: spy }).html, "host-edited");
  assert.equal(downloadDocumentBase({ html: "<base href=/>", rewrite: url => url, sourceEdits: spy }), "host-edited");
  assert.deepEqual(calls, ["elements", "editedHtml", "elements", "editedHtml"]);
});
