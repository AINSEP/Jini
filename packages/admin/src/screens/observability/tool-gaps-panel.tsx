import type { ToolGapEntry } from '@jini-ai/core/contracts/site/daemon-tool-audit';
import { useFetchQuery } from '../../react/kit.js';

import { type Translate } from '@jini-ai/core/text';

/** Reads the owner-only tool-gap projection; the host binds it to its authenticated API client. */
export type ToolGapsRead = () => Promise<{ entries: ToolGapEntry[] }>;

/** The Tool gaps filter reads the server's owner-only audit projection on mount/Refresh.
 * Native inputs/outputs are never fetched; the endpoint returns redacted metadata only. */
export function ToolGapsPanel({ t, read, useFetchQueryHook = useFetchQuery }: { t: Translate; read: ToolGapsRead; useFetchQueryHook?: typeof useFetchQuery; }) {
  const query = useFetchQueryHook({ key: ['observability', 'tool-gaps'], fetch: read }, { staleTime: 0 });
  return <section className="jini-settings-section" aria-label={t('Tool gaps')}>
    <p>{t('Bash and file-edit tool gaps, plus other native CLI tool use.')}</p>
    <button type="button" onClick={() => query.refetch()} disabled={query.isFetching}>{t('Refresh')}</button>
    {query.isFetching ? <p role="status">{t('Loading…')}</p> : null}
    {query.error ? <p role="alert">{query.error.message}</p> : null}
    {query.data?.entries.length === 0 ? <p>{t('No tool gaps recorded.')}</p> : null}
    {query.data?.entries.map(entry => <article key={entry.id} className="jini-settings-section">
      <p><time dateTime={entry.at}>{entry.at}</time> · {entry.provider} · {entry.toolUsed} · {t(entry.type === 'native_tool_used' ? 'Native tool used' : 'Tool gap')}</p>
      <p>{entry.site} · {t('Chat')}: {entry.chatId}</p>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{entry.summary}</pre>
      <p>{entry.type === 'native_tool_used' ? t('Native tool used') : entry.gapLine ?? t('No Tool gap explanation was provided.')}</p>
    </article>)}
  </section>;
}
