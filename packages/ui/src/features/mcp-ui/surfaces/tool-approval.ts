import type { HumanConfirmSpec } from '@jini-ai/core/contracts/site/human-confirm';
import type { SurfaceDetail } from '@jini-ai/core/contracts/cards';
import { approvalText } from '@jini-ai/core/contracts/site/approval-i18n';
import { isNonArrayRecord, type ToolDescriptor } from '@jini-ai/core';
import { surfaceDetailLabel } from './structured-details.js';

type ApprovalText = (required: { key: string }) => string;
type ApprovalDescriptor = Pick<ToolDescriptor, 'id' | 'metadata' | 'inputSchema'>;

function nonBlank({ value }: { value: unknown }, _options = {}): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function record({ value }: { value: unknown }, _options = {}): Record<string, unknown> {
  const candidate = { value };
  return isNonArrayRecord(candidate) ? candidate.value : {};
}

/** Project inline JSON-schema property titles into the existing dotted-path label contract.
 * Only `title`: `description` is guidance written for the model (often a paragraph), not a label;
 * untitled fields keep the renderer's humanized-key fallback. No reference resolution or validation.
 * @complexity O(n * depth) time and space in property-path bytes; no effects or input mutation. */
function schemaLabels(
  { schema, path = '' }: { schema: unknown; path?: string },
  { text }: { text: ApprovalText },
): Record<string, string> {
  const properties = record({ value: record({ value: schema }).properties });
  return Object.fromEntries(Object.entries(properties).flatMap(([key, property]) => {
    const field = record({ value: property });
    const fieldPath = path ? `${path}.${key}` : key;
    const label = nonBlank({ value: field.title });
    return [
      ...(label ? [[fieldPath, text({ key: label })]] : []),
      ...Object.entries(schemaLabels({ schema: field, path: fieldPath }, { text })),
    ];
  }));
}

/** Derive approval copy from the registered catalog, with the shared humanized-key fallback.
 * The host translates copy; supplied input is never evaluated as a template or action metadata.
 * @returns A question title, declared summary, confirm label and structured detail labels.
 * @complexity O(n * depth + k) time/space in schema paths and tool-name bytes; no effects. */
export function toolApprovalPresentation(
  { descriptor }: { descriptor: ApprovalDescriptor },
  { text }: { text: ApprovalText },
): { title: string; summary?: string; confirmLabel: string; labels: Readonly<Record<string, string>> } {
  const fallback = surfaceDetailLabel({ key: descriptor.id.replace(/\./g, ' '), path: '', labels: {} });
  const action = text({ key: nonBlank({ value: descriptor.metadata?.title }) ?? fallback });
  const title = /[?？؟]$/.test(action) ? action : text({ key: '{action}?' }).replace('{action}', () => action);
  const summary = nonBlank({ value: descriptor.metadata?.summary });
  return {
    title,
    ...(summary ? { summary: text({ key: summary }) } : {}),
    confirmLabel: text({ key: nonBlank({ value: descriptor.metadata?.actionVerb }) ?? 'Confirm' }),
    labels: schemaLabels({ schema: descriptor.inputSchema }, { text }),
  };
}

/** Shared operator-language presentation for policy approvals and domain-owned tool plans. */
export function toolApprovalConfirmation({ descriptor, input, locale, details = [], danger = false }: {
  descriptor: Parameters<typeof toolApprovalPresentation>[0]['descriptor']; input: unknown; locale: string;
  details?: readonly SurfaceDetail[]; danger?: boolean;
}, _options = {}): HumanConfirmSpec {
  const toolId = descriptor.id;
  const presentation = toolApprovalPresentation({ descriptor }, { text: ({ key }) => approvalText({ locale, key }) });
  return {
    toolId, errorCode: 'TOOL_APPROVAL', title: presentation.title,
    ...(presentation.summary ? { description: presentation.summary } : {}), details, danger,
    detailDisclosure: { label: approvalText({ locale, key: 'Details' }), details: [
      { label: approvalText({ locale, key: 'Input' }), value: input ?? {}, labels: presentation.labels,
        description: `${approvalText({ locale, key: 'Technical name' })}: ${toolId}` },
    ] },
    confirmLabel: presentation.confirmLabel, cancelLabel: approvalText({ locale, key: 'Cancel' }),
  };
}
