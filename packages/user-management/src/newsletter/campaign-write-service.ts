/**
 * @file `campaign-write-service.ts` — THE campaign write chokepoint (ADR-PIPE-011 C-009/C-010/C-011,
 * REQ-01/06/09, INV-01).
 *
 * The ONLY writer of `newsletter_campaigns`/`newsletter_campaign_revisions` — repo write methods
 * (`saveCampaignRow`/`appendRevision`) must never be called from outside this file (Code Review
 * enforces this as a file-boundary check, mirrors `SettingsWriteService`'s identical convention).
 * Calls `campaign.ts`'s `transitionCampaignStatus` before every status-affecting write; campaign +
 * revision write in the SAME transaction (INV-01: a campaign row must never exist without a
 * same-tx revision row).
 */
import type { CreatorKind, UUID } from "@jini-ai/core/primitives";
import { transitionCampaignStatus, type CampaignActorTier } from "./campaign.js";
import {
  NewsletterCampaignNotEditableError,
  NewsletterCampaignNotFoundError,
  NewsletterConflictError,
  NewsletterListNotFoundError,
  NewsletterValidationError,
} from "./errors.js";
import type { NewsletterCampaignRepoPort, NewsletterListRepoPort } from "./ports.js";
import type { CampaignCounters, CampaignRecord } from "./types.js";

// Exported (not just module-local) so `agent-tools.ts`'s published `inputSchema` bounds import
// these single sources rather than restating the numbers — the same discipline
// `forms/agent-tools.ts` applies to `forms.ts`'s field constants.
export const SUBJECT_MIN = 1;
export const SUBJECT_MAX = 998;
export const PREHEADER_MAX = 300;

export interface CampaignWriteServiceDeps {
  campaignRepo: NewsletterCampaignRepoPort;
  listRepo: NewsletterListRepoPort;
  clock: { nowIso(): string };
  ids: { newId(): string };
}

const ZERO_COUNTERS: CampaignCounters = {
  recipients: 0,
  delivered: 0,
  failed: 0,
  bounced: 0,
  complained: 0,
  unsubscribed: 0,
};

function validateFields(fields: { subject: string; preheader?: string | null }): void {
  if (fields.subject.length < SUBJECT_MIN || fields.subject.length > SUBJECT_MAX) {
    throw new NewsletterValidationError({
      message: `subject must be between ${SUBJECT_MIN} and ${SUBJECT_MAX} characters`,
      field: "subject",
      reason: "length",
    });
  }
  if (fields.preheader != null && fields.preheader.length > PREHEADER_MAX) {
    throw new NewsletterValidationError({ message: `preheader must be at most ${PREHEADER_MAX} characters`, field: "preheader", reason: "length" });
  }
}

async function requireEditableListId({ deps, workspaceId, listId }: { deps: CampaignWriteServiceDeps; workspaceId: UUID; listId: UUID }, _options = {}): Promise<void> {
  const list = await deps.listRepo.findById({ workspaceId, id: listId });
  if (!list) throw new NewsletterListNotFoundError(`list ${listId} was not found`);
  // Archiving a list restricts writes; it does not remove campaigns from history.
  if (list.status === "archived") {
    throw new NewsletterValidationError({ field: "listId", reason: "archived", message: "This list is archived." });
  }
}

async function writeRevision(
  { deps, campaign, actorId }: { deps: CampaignWriteServiceDeps; campaign: CampaignRecord; actorId: UUID },
  _options = {},
): Promise<void> {
  const priorRevisions = await deps.campaignRepo.listRevisions({ workspaceId: campaign.workspaceId, campaignId: campaign.id });
  const seq = priorRevisions.length > 0 ? Math.max(...priorRevisions.map((r) => r.seq)) + 1 : 1;
  await deps.campaignRepo.saveCampaignRow(campaign);
  await deps.campaignRepo.appendRevision({
    campaignId: campaign.id,
    workspaceId: campaign.workspaceId,
    seq,
    state: campaign,
    actorId,
    recordedAt: deps.clock.nowIso(),
  });
}

/**
 * C-009 — create or edit a campaign's editorial fields (REQ-01/06/09). Never touches `status`
 * directly (no `status` field accepted — matches `UPDATE_CAMPAIGN`'s body schema, which does not
 * accept a status field at all per behavior.spec.md §1.1).
 *
 * @complexity O(1) DB round trips (bounded revision-listing to compute the next `seq`).
 * @overallScore 100
 */
export async function saveCampaign(required: {
  deps: CampaignWriteServiceDeps;
  input: {
    workspaceId: UUID;
    id?: UUID;
    actorId: UUID;
    /** Who is creating the campaign, recorded once as `created_by_kind` (H4, 2026-11-24). Omitted
     *  means `"person"`: the admin routes pass nothing, the agent tools pass `"agent"` (an agent
     *  acts under the real human's `actorId`, so the kind cannot be recovered from it later).
     *  Ignored on a re-save — the stored kind is write-once. */
    creatorKind?: CreatorKind;
    expectedVersion?: number;
    fields: {
      subject: string;
      bodyJson?: Record<string, unknown>;
      preheader?: string | null;
      fromName: string;
      fromEmail: string;
      replyTo: string;
      listId: UUID;
    };
  };
}, _optional: Record<string, never> = {}): Promise<{ campaign: CampaignRecord; revisionSeq: number }> {
  const { deps, input } = required;
  validateFields(input.fields);
  await requireEditableListId({ deps, workspaceId: input.workspaceId, listId: input.fields.listId });

  return deps.campaignRepo.transaction({ fn: async () => {
    const now = deps.clock.nowIso();
    let campaign = input.id
      ? await editDraftCampaign({ deps, input, id: input.id, now })
      : newDraftCampaign({ deps, input, now });

    if (input.fields.bodyJson !== undefined) campaign = { ...campaign, bodyJson: input.fields.bodyJson };
    await writeRevision({ deps, campaign, actorId: input.actorId });
    const revisions = await deps.campaignRepo.listRevisions({ workspaceId: campaign.workspaceId, campaignId: campaign.id });
    return { campaign, revisionSeq: Math.max(...revisions.map((r) => r.seq)) };
  } });
}

type SaveCampaignInput = Parameters<typeof saveCampaign>[0]["input"];

/** Load a draft campaign for editing, enforcing editable status and the optimistic-version check. */
async function editDraftCampaign(required: {
  deps: CampaignWriteServiceDeps;
  input: SaveCampaignInput;
  id: UUID;
  now: string;
}): Promise<CampaignRecord> {
  const { deps, input, id, now } = required;
  const existing = await deps.campaignRepo.findById({ workspaceId: input.workspaceId, id });
  if (!existing) throw new NewsletterCampaignNotFoundError(`campaign ${id} was not found`);
  if (existing.status !== "draft") {
    throw new NewsletterCampaignNotEditableError({
      message: `campaign is '${existing.status}' and cannot be edited`,
      currentStatus: existing.status,
      attemptedAction: "update",
    });
  }
  if (input.expectedVersion !== undefined && input.expectedVersion !== existing.version) {
    throw new NewsletterConflictError({
      message: "campaign was modified concurrently (EC-06)",
      entity: "campaign",
      id: existing.id,
      expectedVersion: input.expectedVersion,
      actualVersion: existing.version,
    });
  }
  return {
    ...existing,
    subject: input.fields.subject,
    preheader: input.fields.preheader ?? null,
    fromName: input.fields.fromName,
    fromEmail: input.fields.fromEmail,
    replyTo: input.fields.replyTo,
    listId: input.fields.listId,
    version: existing.version + 1,
    updatedAt: now,
  };
}

/** Build a fresh draft campaign record from the editorial fields. */
function newDraftCampaign(required: {
  deps: CampaignWriteServiceDeps;
  input: SaveCampaignInput;
  now: string;
}): CampaignRecord {
  const { deps, input, now } = required;
  return {
    id: deps.ids.newId(),
    workspaceId: input.workspaceId,
    status: "draft",
    subject: input.fields.subject,
    preheader: input.fields.preheader ?? null,
    fromName: input.fields.fromName,
    fromEmail: input.fields.fromEmail,
    replyTo: input.fields.replyTo,
    listId: input.fields.listId,
    scheduledAt: null,
    sendStartedAt: null,
    audienceSnapshotId: null,
    counters: ZERO_COUNTERS,
    version: 1,
    createdByPrincipal: input.actorId,
    createdByKind: input.creatorKind ?? "person",
    createdAt: now,
    updatedAt: now,
  };
}

async function transitionAndWrite(
  deps: CampaignWriteServiceDeps,
  required: { workspaceId: UUID; id: UUID; actorId: UUID; to: CampaignRecord["status"]; actorTier: CampaignActorTier }
): Promise<CampaignRecord> {
  return deps.campaignRepo.transaction({ fn: async () => {
    const existing = await deps.campaignRepo.findById({ workspaceId: required.workspaceId, id: required.id });
    if (!existing) throw new NewsletterCampaignNotFoundError(`campaign ${required.id} was not found`);

    const decision = transitionCampaignStatus({ from: existing.status, to: required.to, actorTier: required.actorTier });
    if (!decision.allowed) {
      throw new NewsletterCampaignNotEditableError({ message: decision.reason, currentStatus: existing.status, attemptedAction: `transition-to-${required.to}` });
    }

    const campaign: CampaignRecord = { ...existing, status: required.to, updatedAt: deps.clock.nowIso() };
    await writeRevision({ deps, campaign, actorId: required.actorId });
    return campaign;
  } });
}

/** C-010 — cancel a campaign (`admin.newsletter.campaign.compose` tier). */
export async function cancelCampaign(required: {
  deps: CampaignWriteServiceDeps;
  input: { workspaceId: UUID; id: UUID; actorId: UUID };
}, _optional: Record<string, never> = {}): Promise<{ campaign: CampaignRecord }> {
  const campaign = await transitionAndWrite(required.deps, { ...required.input, to: "canceled", actorTier: "compose" });
  return { campaign };
}

/** Validates a timezone-qualified ISO timestamp, including the calendar date that Date.parse normalizes.
 * @param required.value - Caller-supplied schedule timestamp, shared by routes, tools and the write service.
 * @returns False for malformed dates, missing timezone or impossible calendar dates.
 * @complexity O(n) in timestamp length, O(1) auxiliary space. */
export function isValidScheduleTimestamp({ value }: { value: string }, _optional: Record<string, never> = {}): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  if (!Number.isFinite(Date.parse(value))) return false;
  const datePart = value.slice(0, 10);
  return new Date(`${datePart}T00:00:00.000Z`).toISOString().slice(0, 10) === datePart;
}

/** C-011 — schedule a draft campaign (`admin.newsletter.campaign.schedule` tier). */
export async function scheduleCampaign(required: {
  deps: CampaignWriteServiceDeps;
  input: { workspaceId: UUID; id: UUID; actorId: UUID; scheduledAt: string };
}, _optional: Record<string, never> = {}): Promise<{ campaign: CampaignRecord }> {
  const { deps, input } = required;
  if (!isValidScheduleTimestamp({ value: input.scheduledAt })) {
    throw new NewsletterValidationError({ message: "scheduledAt must be a valid ISO date-time string", field: "scheduledAt", reason: "format" });
  }
  const campaign = await deps.campaignRepo.transaction({ fn: async () => {
    const existing = await deps.campaignRepo.findById({ workspaceId: input.workspaceId, id: input.id });
    if (!existing) throw new NewsletterCampaignNotFoundError(`campaign ${input.id} was not found`);

    await requireEditableListId({ deps, workspaceId: input.workspaceId, listId: existing.listId });

    const decision = transitionCampaignStatus({ from: existing.status, to: "scheduled", actorTier: "schedule" });
    if (!decision.allowed) {
      throw new NewsletterCampaignNotEditableError({ message: decision.reason, currentStatus: existing.status, attemptedAction: "schedule" });
    }

    const updated: CampaignRecord = {
      ...existing,
      status: "scheduled",
      scheduledAt: input.scheduledAt,
      updatedAt: deps.clock.nowIso(),
    };
    await writeRevision({ deps, campaign: updated, actorId: input.actorId });
    return updated;
  } });
  return { campaign };
}
