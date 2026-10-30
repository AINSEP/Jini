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

/** Project inline JSON-schema property copy into the existing dotted-path label contract.
 * No reference resolution or schema validation; unknown fields keep the renderer's fallback.
 * @complexity O(n * depth) time and space in property-path bytes; no effects or input mutation. */
function schemaLabels(
  { schema, path = '' }: { schema: unknown; path?: string },
  { text }: { text: ApprovalText },
): Record<string, string> {
  const properties = record({ value: record({ value: schema }).properties });
  return Object.fromEntries(Object.entries(properties).flatMap(([key, property]) => {
    const field = record({ value: property });
    const fieldPath = path ? `${path}.${key}` : key;
    const label = nonBlank({ value: field.title }) ?? nonBlank({ value: field.description });
    return [
      ...(label ? [[fieldPath, text({ key: label })]] : []),
      ...Object.entries(schemaLabels({ schema: field, path: fieldPath }, { text })),
    ];
  }));
}

/** Derive approval copy from the registered catalog, with the shared humanized-key fallback.
 * The host translates copy; supplied input is never evaluated as a template or action metadata.
 * @returns A question title, confirm label and labels for the shared structured detail renderer.
 * @complexity O(n * depth + k) time/space in schema paths and tool-name bytes; no effects. */
export function toolApprovalPresentation(
  { descriptor }: { descriptor: ApprovalDescriptor },
  { text }: { text: ApprovalText },
): { title: string; confirmLabel: string; labels: Readonly<Record<string, string>> } {
  const fallback = surfaceDetailLabel({ key: descriptor.id.replace(/\./g, ' '), path: '', labels: {} });
  const action = text({ key: nonBlank({ value: descriptor.metadata?.title }) ?? fallback });
  const title = /[?？؟]$/.test(action) ? action : text({ key: '{action}?' }).replace('{action}', () => action);
  return {
    title,
    confirmLabel: text({ key: nonBlank({ value: descriptor.metadata?.actionVerb }) ?? 'Confirm' }),
    labels: schemaLabels({ schema: descriptor.inputSchema }, { text }),
  };
}
