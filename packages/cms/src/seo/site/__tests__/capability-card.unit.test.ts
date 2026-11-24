import { expect, test } from "vitest";

import { capabilityCard } from "../capability-card.js";

/**
 * @file Characterization of the SEO learning card, written when it moved from the host: the card
 * the site guide lists under `seo`, gated on `admin.seo.manage`, pointing at the read-only settings
 * tool and the SEO admin screen. Every pointer must carry only permissions the card itself requires.
 */

test("the SEO capability card names its topic, permission and pointers", () => {
  expect(capabilityCard.id).toBe("seo");
  expect(capabilityCard.title).toBe("SEO");
  expect(capabilityCard.permissions).toEqual(["admin.seo.manage"]);
  expect(capabilityCard.pointers.map((pointer) => ("tool" in pointer ? pointer.tool : pointer.href))).toEqual(["seo_get_settings", "/admin/seo"]);
  expect(capabilityCard.workflows).toEqual([]);
});

test("every SEO card pointer is gated only on permissions the card declares", () => {
  for (const pointer of capabilityCard.pointers) {
    expect(pointer.permissions.length).toBeGreaterThan(0);
    for (const permission of pointer.permissions) expect(capabilityCard.permissions).toContain(permission);
  }
});
