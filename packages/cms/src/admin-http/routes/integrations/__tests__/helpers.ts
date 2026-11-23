import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { WebhookDeliveryRow, WebhookSubscriptionRow } from "../../../http/integrations.js";

/** @file Shared fakes for the integrations route-spec tests: fixed rows, the host's error classes, a recording authorizer and the refusal reader. */

export const WORKSPACE_ID = "ws-1";
export const signal = new AbortController().signal;

/** Stand-ins for the host service's two anticipated failures: the specs must map them without importing the host's classes. */
export class FakeValidationError extends Error {}
export class FakeNotFoundError extends Error {}

/** The matchers a host injects: `instanceof` against its own error classes. */
export const isValidationError = ({ err }: { err: unknown }, _o: Record<string, never> = {}): boolean => err instanceof FakeValidationError;
export const isNotFoundError = ({ err }: { err: unknown }, _o: Record<string, never> = {}): boolean => err instanceof FakeNotFoundError;

/** One stored subscription. The extra attribution fields a real record carries are present so a test can prove they never reach the wire. */
export function fakeSubscription(overrides: Partial<WebhookSubscriptionRow> = {}): WebhookSubscriptionRow {
  return {
    id: "sub-1", label: "Orders", targetUrl: "https://hooks.example.com/orders", topics: ["post.published"], status: "active",
    secretVersion: 2, previousSecretVersion: 1, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z",
    disabledAt: null, version: 3,
    ...({ ownerPrincipalId: "owner-secret", createdByPrincipalId: "creator-secret", createdByPluginId: null, workspaceId: WORKSPACE_ID } as object),
    ...overrides,
  };
}

/** The admin wire form of {@link fakeSubscription} with no delivery yet: exactly the projected fields, no attribution. */
export function fakeSubscriptionDto(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub-1", label: "Orders", targetUrl: "https://hooks.example.com/orders", topics: ["post.published"], status: "active",
    secretVersion: 2, previousSecretVersion: 1, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z",
    disabledAt: null, version: 3, lastDelivery: null, ...overrides,
  };
}

/** One delivery row, with the workspace id the admin wire must drop. */
export function fakeDelivery(overrides: Partial<WebhookDeliveryRow> = {}): WebhookDeliveryRow {
  return {
    id: "d-1", subscriptionId: "sub-1", eventId: "ev-1", topic: "post.published", status: "delivered", attempts: 1,
    nextAttemptAt: "2026-10-03T00:00:00.000Z", lastResponseStatus: 204, lastError: null, signedWithVersion: 2,
    createdAt: "2026-10-03T00:00:00.000Z", deliveredAt: "2026-10-03T00:00:01.000Z", deadAt: null,
    ...({ workspaceId: WORKSPACE_ID } as object),
    ...overrides,
  };
}

/** One recorded authorization: the permission, the entity type and, for by-id routes, the entity id. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize`; `denied` permissions throw, as the host port's 403 refusal would. */
export function recordingAuthorize(denied: readonly string[] = []): {
  authorize: (r: { permission: string; entityType: string }, o?: { entityId?: string }) => Promise<void>; calls: RecordedAuthorize[];
} {
  const calls: RecordedAuthorize[] = [];
  return {
    calls,
    authorize: async ({ permission, entityType }, optional = {}) => {
      calls.push({ permission, entityType, ...optional });
      if (denied.includes(permission)) throw new Error(`denied ${permission}`);
    },
  };
}

/** Run `fn` and return the refusal it throws (status + flat body); fails if it does not refuse. */
export async function refusalOf(fn: () => unknown): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof RouteRefusalError) return error.response;
    throw error;
  }
  throw new Error("expected a route refusal");
}

/** The raw input a host adapter hands `parse`. */
export const raw = (params: Record<string, string>, body: unknown = {}, query: Record<string, unknown> = {}) => ({ body, query, params });
