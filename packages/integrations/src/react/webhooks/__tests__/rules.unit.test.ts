import { describe, expect, it, vi } from "vitest";
import type { AdminWebhookDeliveryResponse, AdminWebhookSubscriptionResponse } from "@jini-ai/core/contracts/site/cms-integrations";
import { displayTimestamp, integrationRowMenuItems, KEYS, parseTopics, visibleIntegrationsError } from "../rules.js";

const sub = (status: AdminWebhookSubscriptionResponse["status"]): AdminWebhookSubscriptionResponse => ({
  id: "s1", label: "Hook", targetUrl: "https://example.com/h", topics: [], status, secretVersion: 1, previousSecretVersion: null,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", disabledAt: null, lastDelivery: null });
const translate = ({ locale, key }: { locale: string; key: string }) => `${locale}/${key}`;

describe("integration row menu", () => {
  it("offers Resume for paused rows and Pause otherwise, plus a destructive Delete", () => {
    const handlers = { onTogglePause: vi.fn(), onDelete: vi.fn() };
    const paused = integrationRowMenuItems({ subscription: sub("paused"), handlers, locale: "de", translate });
    expect(paused.map(i => [i.key, i.label, i.destructive])).toEqual([["pause", "de/Resume", undefined], ["delete", "de/Delete", true]]);
    expect(integrationRowMenuItems({ subscription: sub("active"), handlers, locale: "de", translate })[0]!.label).toBe("de/Pause");
    paused[0]!.onSelect();
    paused[1]!.onSelect();
    expect(handlers.onTogglePause).toHaveBeenCalledWith(sub("paused"));
    expect(handlers.onDelete).toHaveBeenCalledWith(sub("paused"));
  });
});

describe("delivery timestamp and keys", () => {
  const delivery = (createdAt: string, deliveredAt: string | null): AdminWebhookDeliveryResponse => ({ id: "d", subscriptionId: "s1", eventId: "e", topic: "t", status: "delivered",
    attempts: 1, nextAttemptAt: createdAt, lastResponseStatus: 200, lastError: null, signedWithVersion: 1, createdAt, deliveredAt, deadAt: null });

  it("prefers deliveredAt and falls back to createdAt", () => {
    const viewerTimeZone = "UTC";
    const delivered = displayTimestamp({ delivery: delivery("2026-01-01T00:00:00Z", "2026-03-04T05:06:00Z"), viewerTimeZone });
    expect(delivered).toBe(displayTimestamp({ delivery: delivery("2026-03-04T05:06:00Z", null), viewerTimeZone }));
    expect(delivered).not.toBe(displayTimestamp({ delivery: delivery("2026-01-01T00:00:00Z", null), viewerTimeZone }));
  });

  it("builds per-subscription delivery keys and parses topics", () => {
    expect(KEYS.deliveries({ subscriptionId: "s9" })).toEqual(["integration-deliveries", "s9"]);
    expect(parseTopics({ raw: " a ,, b," })).toEqual(["a", "b"]);
  });
});

describe("visibleIntegrationsError", () => {
  it("orders toggle, delete, then list error; hides the list error once rows exist", () => {
    const describeApiError = ({ e, fallback }: { e: unknown; fallback: string }) => `${fallback}|${(e as Error).message}`;
    const base = { toggleError: null, deleteError: null, listError: new Error("L"), hasSubscriptions: false, locale: "en", translate, describeApiError };
    expect(visibleIntegrationsError({ ...base, toggleError: new Error("T"), deleteError: new Error("D") })).toBe("en/failed to update subscription|T");
    expect(visibleIntegrationsError({ ...base, deleteError: new Error("D") })).toBe("en/failed to delete subscription|D");
    expect(visibleIntegrationsError(base)).toBe("en/failed to load integrations|L");
    expect(visibleIntegrationsError({ ...base, hasSubscriptions: true })).toBeNull();
    expect(visibleIntegrationsError({ ...base, listError: null })).toBeNull();
  });
});
