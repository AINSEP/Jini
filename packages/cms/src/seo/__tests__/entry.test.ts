/** @file The universal `seo` entry re-exports every runtime binding of its modules unchanged. */
import { expect, test } from "vitest";
import * as entry from "../index.js";
import * as types from "../types.js";
import * as errors from "../errors.js";
import * as ports from "../ports.js";
import * as absoluteUrl from "../absolute-url.js";
import * as seo from "../seo.js";
import * as media from "../media.js";
import * as sitemap from "../sitemap.js";
import * as feed from "../feed.js";
import * as pageHead from "../page-head.js";
import * as writeService from "../write-service.js";
import * as xmlEscape from "../xml-escape.js";

test("the seo entry re-exports every runtime binding of its producer, service and port modules", () => {
  const owners: object[] = [types, errors, ports, absoluteUrl, seo, media, sitemap, feed, pageHead, writeService, xmlEscape];
  const expected: Record<string, unknown> = Object.assign({}, ...owners.map((owner) => ({ ...owner })));
  expect(Object.keys(entry).sort()).toEqual(Object.keys(expected).sort());
  for (const [name, binding] of Object.entries(expected)) expect((entry as Record<string, unknown>)[name], name).toBe(binding);
});
