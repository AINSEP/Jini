import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { NewsletterCampaign, NewsletterErrorMapper, NewsletterList, NewsletterSubscription } from "../../../http/newsletter.js";

/** @file Shared fakes for the newsletter route-spec tests: a campaign row, a recording authorizer, a fake host error mapper and the refusal reader. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const NOW = "2026-11-23T00:00:00.000Z";
export const signal = new AbortController().signal;

/** One stored campaign, with every field the specs read. */
export function fakeCampaign(overrides: Partial<NewsletterCampaign> = {}): NewsletterCampaign {
  return {
    id: "camp-1", status: "draft", subject: "Autumn", preheader: null, fromName: "Acme", fromEmail: "news@acme.test",
    replyTo: "help@acme.test", listId: "list-1", bodyJson: { type: "doc" }, ...overrides,
  };
}

type FakeList = NewsletterList & { slug: string };
type FakeSubscription = NewsletterSubscription & { status: string };

/** One stored list, with the fields the specs read plus one the host keeps (which must reach the wire). */
export function fakeList(overrides: Partial<FakeList> = {}): FakeList {
  return { id: "list-1", slug: "weekly", ...overrides };
}

/** One stored subscription, with every field the specs read plus one the host keeps. */
export function fakeSubscription(overrides: Partial<FakeSubscription> = {}): FakeSubscription {
  return { id: "sub-1", listId: "list-1", subscriberId: "member-1", status: "pending", ...overrides };
}

/** Stands in for a host error class: the host's mapper (injected) knows it, the engine does not. */
export class MappedTestError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(String(body.error));
  }
}

/** The injected host mapper: answers {@link MappedTestError} with its own status and body, anything else is unmapped. */
export const mapTestError: NewsletterErrorMapper = ({ err }) => (err instanceof MappedTestError ? { status: err.status, body: err.body } : undefined);

/** One recorded authorization: permission and entity type, plus an entity id only if one was sent. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize`; `denied` permissions throw, as the host port's 403 refusal would. */
export function recordingAuthorize(denied: readonly string[] = [], events: string[] = []): {
  authorize: (r: { permission: string; entityType: string }, o?: { entityId?: string }) => Promise<void>; calls: RecordedAuthorize[];
} {
  const calls: RecordedAuthorize[] = [];
  return {
    calls,
    authorize: async ({ permission, entityType }, optional = {}) => {
      events.push("authorize");
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

/** The three fields every newsletter route reads; `newsletterReady` records when it is awaited. */
export function baseDeps(events: string[] = []) {
  const newsletterReady: PromiseLike<unknown> = {
    then: (onfulfilled, onrejected) => {
      events.push("ready");
      return Promise.resolve(undefined).then(onfulfilled, onrejected);
    },
  };
  return { workspaceId: WORKSPACE_ID, newsletterReady, mapNewsletterError: mapTestError };
}

/** Every collaborator any newsletter route reads, each answering through `call` (name + input), so one
 *  table can drive the shared admission and error rules across all nineteen routes. */
export function allDeps(call: (name: string, input: unknown) => unknown, events: string[] = []) {
  const via = (name: string) => async (input: unknown = {}) => call(name, input);
  return {
    ...baseDeps(events),
    newsletterCampaignRepo: { findById: via("findById"), list: via("list") },
    newsletterSendRepo: { listByCampaign: via("listByCampaign") },
    saveCampaign: via("saveCampaign"),
    scheduleCampaign: via("scheduleCampaign"),
    cancelCampaign: via("cancelCampaign"),
    pauseCampaign: via("pauseCampaign"),
    resumeCampaign: via("resumeCampaign"),
    sendTestCampaign: via("sendTestCampaign"),
    openSendPipeline: () => ({ authorizeSend: via("authorizeSend"), freezeAudience: via("freezeAudience"), claimBatch: via("claimBatch") }),
    reportDeliveryFailure: () => undefined,
    clock: { nowIso: () => NOW },
    newsletterListRepo: { list: via("listLists") },
    newsletterSubscriptionRepo: { findById: via("findSubscription"), list: via("listSubscriptions") },
    newsletterSubscriberDirectory: { getContact: via("getContact") },
    saveList: via("saveList"),
    archiveList: via("archiveList"),
    saveSubscription: via("saveSubscription"),
    importSubscriptions: via("importSubscriptions"),
    unsubscribeSubscription: via("unsubscribeSubscription"),
    issueConfirmationToken: via("issueConfirmationToken"),
  };
}
