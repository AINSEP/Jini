import { expect, test } from "vitest";
import { escapeHtml, escapeXml } from "./index.js";

test("the shared leaf escapers preserve HTML and XML apostrophes without double escaping replacements", () => {
  const text = `&<>"' &amp; <script>日本語`;
  expect(escapeHtml({ text })).toBe("&amp;&lt;&gt;&quot;&#39; &amp;amp; &lt;script&gt;日本語");
  expect(escapeXml({ text })).toBe("&amp;&lt;&gt;&quot;&apos; &amp;amp; &lt;script&gt;日本語");
  expect(escapeHtml({ text: "" })).toBe("");
  expect(escapeXml({ text: "" })).toBe("");
});
