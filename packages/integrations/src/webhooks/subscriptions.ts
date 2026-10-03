import { nowIso } from "@jini-ai/core/primitives";
import { IntegrationError } from "../argument-error.js";
import type { Clock, IdGenerator, UUID } from "@jini-ai/core/primitives";

import type { WebhookSubscriptionRepoPort } from "./ports.js";
import type { WebhookSubscriptionRecord, WebhookTopic } from "./types.js";

export class WebhookSubscriptionNotFoundError extends IntegrationError {}
export class WebhookSubscriptionValidationError extends IntegrationError {}

export interface WebhookSubscriptionDeps {
  // Hosts authorize before calling this write service. The egress predicate is also injected so
  // subscription rules stay independent of a consumer's origin registry and provider wiring.
  clock: Clock;
  repo: WebhookSubscriptionRepoPort;
  idGenerator: IdGenerator;
  isAllowedTarget: (required: { url: string }) => Promise<boolean>;
}

export interface CreateSubscriptionInput {
  workspaceId: UUID;
  ownerPrincipalId: UUID;
  label: string;
  targetUrl: string;
  topics: readonly WebhookTopic[];
  createdByPrincipalId: UUID;
}

export interface CreateSubscriptionRequired {
  deps: WebhookSubscriptionDeps;
  input: CreateSubscriptionInput;
}

export interface WebhookSubscriptionOptional { createdByPluginId?: string | null; }

/** Validate then insert an active subscription; no write occurs on validation failure. */
export async function createSubscription(
  required: CreateSubscriptionRequired,
  optional: WebhookSubscriptionOptional = {}
): Promise<{ subscription: WebhookSubscriptionRecord }> {
  const { deps, input } = required;

  const label = input.label.trim();
  if (!label) throw new WebhookSubscriptionValidationError({ message: "label is required" });

  const targetUrl = await validateTargetUrl({
    targetUrl: input.targetUrl,
    isAllowedTarget: deps.isAllowedTarget,
  });

  const topics = normalizeTopics(input.topics);
  if (topics.length === 0) {
    throw new WebhookSubscriptionValidationError({ message: "at least one topic is required" });
  }

  const now = nowIso({ clock: deps.clock });
  const subscription: WebhookSubscriptionRecord = {
    id: deps.idGenerator.newId(),
    workspaceId: input.workspaceId,
    ownerPrincipalId: input.ownerPrincipalId,
    label,
    targetUrl,
    topics,
    secretVersion: 1,
    // Track generation identity only; signing secrets are derived at delivery time, not stored here.
    previousSecretVersion: null,
    status: "active",
    createdByPrincipalId: input.createdByPrincipalId,
    createdByPluginId: optional.createdByPluginId ?? null,
    createdAt: now,
    updatedAt: now,
    disabledAt: null,
  };

  await deps.repo.insert(subscription);
  return { subscription };
}

export interface UpdateSubscriptionInput {
  workspaceId: UUID;
  id: UUID;
  label: string;
  targetUrl: string;
  topics: readonly WebhookTopic[];
}

export interface UpdateSubscriptionRequired {
  deps: WebhookSubscriptionDeps;
  input: UpdateSubscriptionInput;
}

/** Validate a replacement before saving; missing workspace-scoped rows throw. */
export async function updateSubscription(
  required: UpdateSubscriptionRequired,
  _optional: WebhookSubscriptionOptional = {}
): Promise<{ subscription: WebhookSubscriptionRecord }> {
  const { deps, input } = required;

  const existing = await deps.repo.findById({ workspaceId: input.workspaceId, id: input.id });
  if (!existing) {
    throw new WebhookSubscriptionNotFoundError({ message: `webhook subscription '${input.id}' was not found` });
  }

  const label = input.label.trim();
  if (!label) throw new WebhookSubscriptionValidationError({ message: "label is required" });

  const targetUrl = await validateTargetUrl({
    targetUrl: input.targetUrl,
    isAllowedTarget: deps.isAllowedTarget,
  });

  const topics = normalizeTopics(input.topics);
  if (topics.length === 0) {
    throw new WebhookSubscriptionValidationError({ message: "at least one topic is required" });
  }

  const subscription: WebhookSubscriptionRecord = {
    ...existing,
    label,
    targetUrl,
    topics,
    updatedAt: nowIso({ clock: deps.clock }),
  };

  await deps.repo.save(subscription);
  return { subscription };
}

export interface PauseSubscriptionInput {
  workspaceId: UUID;
  id: UUID;
}

export interface PauseSubscriptionRequired {
  deps: WebhookSubscriptionDeps;
  input: PauseSubscriptionInput;
}

export interface PauseSubscriptionOptional {
  paused?: boolean;
}

/** Pause or resume a subscription; disabled subscriptions cannot resume. */
export async function pauseSubscription(
  required: PauseSubscriptionRequired,
  optional: PauseSubscriptionOptional = {}
): Promise<{ subscription: WebhookSubscriptionRecord }> {
  const { deps, input } = required;
  const { paused = true } = optional;

  const existing = await deps.repo.findById({ workspaceId: input.workspaceId, id: input.id });
  if (!existing) {
    throw new WebhookSubscriptionNotFoundError({ message: `webhook subscription '${input.id}' was not found` });
  }
  if (existing.status === "disabled") {
    // Soft deletion is terminal: preserving audit history must not offer a resume-to-life path.
    throw new WebhookSubscriptionValidationError({ message: `webhook subscription '${input.id}' is disabled and cannot be paused or resumed` });
  }

  const subscription: WebhookSubscriptionRecord = {
    ...existing,
    status: paused ? "paused" : "active",
    updatedAt: nowIso({ clock: deps.clock }),
  };

  await deps.repo.save(subscription);
  return { subscription };
}

export interface DeleteSubscriptionInput {
  workspaceId: UUID;
  id: UUID;
}

export interface DeleteSubscriptionRequired {
  deps: WebhookSubscriptionDeps;
  input: DeleteSubscriptionInput;
}

/** Soft-disable a subscription while retaining its audit history. */
export async function deleteSubscription(
  required: DeleteSubscriptionRequired,
  _optional: WebhookSubscriptionOptional = {}
): Promise<{ subscription: WebhookSubscriptionRecord }> {
  // Retain the row and disabledAt for audit durability; the repository intentionally has no delete.
  const { deps, input } = required;

  const existing = await deps.repo.findById({ workspaceId: input.workspaceId, id: input.id });
  if (!existing) {
    throw new WebhookSubscriptionNotFoundError({ message: `webhook subscription '${input.id}' was not found` });
  }

  const now = nowIso({ clock: deps.clock });
  const subscription: WebhookSubscriptionRecord = {
    ...existing,
    status: "disabled",
    disabledAt: now,
    updatedAt: now,
  };

  await deps.repo.save(subscription);
  return { subscription };
}

async function validateTargetUrl(params: {
  targetUrl: string;
  isAllowedTarget: (required: { url: string }) => Promise<boolean>;
}): Promise<string> {
  const trimmed = params.targetUrl.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new WebhookSubscriptionValidationError({ message: `target_url '${params.targetUrl}' is not a valid URL` });
  }

  if (parsed.protocol !== "https:") {
    throw new WebhookSubscriptionValidationError({ message: "target_url must use https://" });
  }

  const allowed = await params.isAllowedTarget({ url: trimmed });
  // HTTPS alone is not an SSRF defense: the host must also enforce its allowed egress targets.
  if (!allowed) {
    throw new WebhookSubscriptionValidationError({ message: `target_url '${trimmed}' is not an allowed egress target` });
  }

  return trimmed;
}

function normalizeTopics(topics: readonly WebhookTopic[]): WebhookTopic[] {
  const seen = new Set<string>();
  const normalized: WebhookTopic[] = [];

  for (const topic of topics) {
    const trimmed = topic.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}
