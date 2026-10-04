import { useCallback } from 'react';
import type { SourceControlRowView } from './ProvidersTab.hooks.js';
/** ui-kit's opaque attrs carry semantic metadata, not arbitrary input attributes.
 * Use its forwarded input ref for credential autofill policy. Chrome ignores off for
 * credential-shaped fields, so secret fields explicitly opt into new-password. */
export function useSourceControlCredentialFields({ row }: { row: SourceControlRowView }, _optional = {}) {
  const tokenRef = useCallback((node: HTMLInputElement | null) => { node?.setAttribute('autocomplete', 'new-password'); }, []);
  return { ...row, tokenRef, fields: row.fields.map(field => ({ ...field, ref(node: HTMLInputElement | null) { node?.setAttribute('autocomplete', field.secret ? 'new-password' : 'off'); } })) };
}
