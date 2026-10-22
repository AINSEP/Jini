import { Notice } from '@jini-ai/ui-kit/react';
import type { SourceControlRowView } from '../hooks/ProvidersTab.hooks.js';
import { SourceControlCredentialFields } from './SourceControlCredentialFields.js';
export function SourceControlProviderRow({ row }: { row: SourceControlRowView }, _optional = {}) {
  return <details name="jini-source-control-provider" open={row.defaultOpen} data-jini-part="source-control.provider"><summary><h2>{row.heading}</h2>{row.saved && <><span>Token saved</span><span>Saved {row.saved.updatedAt}</span><span>Replace token ▾</span></>}{!row.saved && <span>Expand ▾</span>}</summary>{row.unlisted ? <Notice>Its plugin is off or missing. Manage this token on the Access tokens page.</Notice> : row.canEdit ? <SourceControlCredentialFields row={row} /> : <Notice>Read-only connection</Notice>}</details>;
}
