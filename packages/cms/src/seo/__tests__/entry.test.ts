/** @file The universal `seo` entry re-exports every runtime binding of its modules unchanged. */
import { expect, test } from "vitest";
import * as entry from "../index.js";
import * as types from "../types.js";
import * as errors from "../errors.js";
import * as settingsLimits from "../settings-limits.js";
import * as agentTools from "../agent-tools.js";
import * as toolRegistrations from "../tool-registrations.js";
import * as ports from "../ports.js";
import * as absoluteUrl from "../absolute-url.js";
import * as seo from "../seo.js";
import * as media from "../media.js";
import * as sitemap from "../sitemap.js";
import * as sitemapDocuments from "../sitemap-documents.js";
import * as feed from "../feed.js";
import * as pageHead from "../page-head.js";
import * as writeService from "../write-service.js";
import { escapeXml as coreEscapeXml } from "@jini-ai/core/text";
import * as htmlPlainText from "../html-plain-text.js";

test("the seo entry re-exports every runtime binding of its producer, service and port modules", () => {
  const owners: object[] = [types, errors, settingsLimits, agentTools, toolRegistrations, ports, absoluteUrl, seo, media, sitemap, sitemapDocuments, feed, pageHead, writeService, { escapeXml: coreEscapeXml }, htmlPlainText];
  const expected: Record<string, unknown> = Object.assign({}, ...owners.map((owner) => ({ ...owner })));
  expect(Object.keys(entry).sort()).toEqual(Object.keys(expected).sort());
  for (const [name, binding] of Object.entries(expected)) expect((entry as Record<string, unknown>)[name], name).toBe(binding);
});

test("the seo entry exposes the core text owner's escapeXml itself, with the XML apostrophe entity", () => {
  expect(entry.escapeXml).toBe(coreEscapeXml);
  expect(entry.escapeXml({ text: `&<>"'` })).toBe("&amp;&lt;&gt;&quot;&apos;");
});
