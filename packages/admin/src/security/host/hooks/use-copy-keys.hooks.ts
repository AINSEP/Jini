import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent } from 'react';

import type { AdminCredentialCopySource, AdminCredentialCopyResult } from '@jini-ai/core/contracts/site/api-security-api-types';

import { type Translate } from '@jini-ai/core/text';
export interface CopyKeysPort {
  listCredentialCopySources(
    required: Record<string, never>,
    optional?: Record<string, never>,
  ): Promise<{ sources: AdminCredentialCopySource[] }>;
  copyCredentials(
    required: { sourceSiteId: string; ids: string[]; overwrite: boolean },
    optional?: Record<string, never>,
  ): Promise<{ results: AdminCredentialCopyResult[] }>;
}

export interface CopyKeysArgs {
  t: Translate;
  port: CopyKeysPort;
  onGranted: (required: Record<string, never>, optional?: Record<string, never>) => void;
  sharedKeys: { sourceSiteId: string; loadFailed: string; grantFailed: string };
}

/** Present metadata-only key choices; this never reads or copies credential values. */
function copyKeyRows({ source, credentialId }: { source: AdminCredentialCopySource | undefined; credentialId: string }) {
  return (source?.keys ?? []).map(key => ({ id: key.id, checked: key.id === credentialId,
    text: key.siteName ? key.label : `${key.label} · ${key.provider ?? key.kind}`, worksFor: (key.worksFor ?? []).join(', '), locked: key.locked ?? '' }));
}

function copyKeyOmissions({ source }: { source: AdminCredentialCopySource | undefined }, _optional: Record<string, never> = {}) {
  return source?.keys.flatMap(key => key.siteName && key.omittedCount !== undefined ? [{ id: key.id, siteName: key.siteName, count: key.omittedCount }] : []) ?? [];
}

/** One metadata read per open, one approval per key; a key saved on another site is added to Shared Keys first.
 * @returns The existing dialog controller with secret-free labels and outcomes.
 * @complexity O(k) time/space per open for at most 50 owner metadata rows; no background polling.
 */
export function useCopyKeys(required: CopyKeysArgs, _optional: Record<string, never> = {}) {
  const { t, port, onGranted, sharedKeys } = required;
  const client = useRef(port).current;
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<AdminCredentialCopySource>();
  const [credentialId, setCredentialId] = useState('');
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<AdminCredentialCopyResult[]>([]);
  const busy = useRef(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    client.listCredentialCopySources({}).then(({ sources }) => {
      if (live) setSource(sources.find(row => row.siteId === sharedKeys.sourceSiteId));
    }).catch(() => { if (live) setError(sharedKeys.loadFailed); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [client, open]);
  const selected = source?.keys.find(key => key.id === credentialId && !key.locked);
  const disabled = loading || pending || !selected;
  const show = (event: Pick<MouseEvent<HTMLButtonElement>, 'currentTarget'>) => {
    event.currentTarget.focus({ preventScroll: true });
    setSource(undefined); setCredentialId(''); setResults([]); setError(''); setOpen(true);
  };
  const cancel = () => { if (!busy.current) setOpen(false); };
  const changeKey = (event: ChangeEvent<HTMLInputElement>) => {
    setCredentialId(event.currentTarget.checked ? event.currentTarget.value : '');
  };
  const submit = async (event: Pick<FormEvent<HTMLFormElement>, 'preventDefault'>) => {
    event.preventDefault();
    if (disabled || busy.current) return;
    busy.current = true; setPending(true); setError(''); setResults([]);
    try {
      const response = await client.copyCredentials({ sourceSiteId: sharedKeys.sourceSiteId, ids: [credentialId], overwrite: false });
      setResults(response.results);
      onGranted({});
    } catch { setError(sharedKeys.grantFailed); }
    finally { busy.current = false; setPending(false); }
  };
  return { open, show, cancel, submit, loading, pending, disabled, changeKey,
    empty: !loading && !source?.keys.length,
    error: error ? t(error) : '',
    keys: copyKeyRows({ source, credentialId }),
    omissions: copyKeyOmissions({ source }),
    results: results.map((result, index) => ({ key: `${result.id}:${index}`,
      text: result.status === 'granted' ? t('Granted to this site') : t(sharedKeys.grantFailed) })),
  };
}

export type CopyKeysController = ReturnType<typeof useCopyKeys>;
