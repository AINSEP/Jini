import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ConnectorsPort } from '@jini-ai/ui-core';
import type { Connector } from '@jini-ai/ui-core';
import { mergeConnectors } from '@jini-ai/ui-core';

export interface ConnectorCatalogOptions {
  /** Whether the host's provider is configured (e.g. an API key is saved) — gates lazy enrichment. */
  unlocked: boolean;
  /** Bump to force both the base catalog and the enrichment pass to re-run. */
  refreshKey?: string | number;
}

export interface ConnectorCatalogController {
  connectors: Connector[];
  setConnectors: Dispatch<SetStateAction<Connector[]>>;
  loading: boolean;
  enriching: boolean;
  enriched: boolean;
}

/**
 * Owns the connector catalog's two-phase load: an always-on lightweight
 * fetch (so already-configured connectors render immediately), then a lazy
 * enrichment pass gated on `unlocked` — heavier, only worth it once the
 * host's provider is actually configured.
 */
export function useConnectorCatalog(port: ConnectorsPort, options: ConnectorCatalogOptions): ConnectorCatalogController {
  const { unlocked, refreshKey = 0 } = options;
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [enriched, setEnriched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEnriched(false);
    (async () => {
      const next = await port.fetchConnectors();
      if (cancelled) return;
      setConnectors((curr) => mergeConnectors(curr, next));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, refreshKey]);

  useEffect(() => {
    if (!unlocked || !port.fetchConnectorEnrichment) {
      setEnriched(false);
      setEnriching(false);
      return;
    }
    if (enriched) return;

    let cancelled = false;
    setEnriching(true);
    (async () => {
      const next = await port.fetchConnectorEnrichment!({ refresh: true });
      if (cancelled) return;
      setConnectors((curr) => mergeConnectors(curr, next));
      setEnriched(true);
      setEnriching(false);
    })();
    return () => {
      cancelled = true;
      setEnriching(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, refreshKey, enriched]);

  return { connectors, setConnectors, loading, enriching, enriched };
}
