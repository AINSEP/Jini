// Field spec for the MCP-server-shaped `SourceConfigList` mount below.
// Mirrors OD's original `McpClientSection.tsx` add-a-server fields (id,
// transport, command, args, env) using the generic `SourceFieldSpec[]` seam
// `features/source-config-list/types.ts` documents. That primitive's own
// provenance notes are explicit that the MCP-server shape has no trust
// concept at all (`packages/ui/source-map.md`'s "the specific trust
// vocabulary ... never hardcoded ... the origin MCP-server shape has none"),
// so this feature defines no `SourceTrustOption[]` to go with it.
import type { SourceFieldSpec } from '@jini-ai/ui-core';

export const MCP_SOURCE_FIELD_SPECS: readonly SourceFieldSpec[] = [
  { key: 'id', label: 'ID', kind: 'text', required: true },
  {
    key: 'transport',
    label: 'Transport',
    kind: 'select',
    required: true,
    options: [
      { value: 'stdio', label: 'stdio' },
      { value: 'http', label: 'http' },
    ],
  },
  { key: 'command', label: 'Command', kind: 'text', placeholder: 'e.g. npx, node, /path/to/binary' },
  { key: 'args', label: 'Args', kind: 'text', placeholder: 'space-separated' },
  // `secret-textarea`, not `textarea`: this block routinely holds live tokens —
  // its own placeholder says so — and a plain textarea rendered them verbatim in
  // the expandable server card, because `maskFieldValue` masked only `password`.
  // The secret kind masks each line's VALUE while keeping its NAME visible, so
  // an operator can still see which variables are set.
  { key: 'env', label: 'Env (KEY=VALUE)', kind: 'secret-textarea', placeholder: 'GITHUB_TOKEN=ghp_…' },
];
