import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ConnectorsPort } from '@jini-ai/ui-core';
import type { Connector } from '@jini-ai/ui-core';
import { hasLoadedAllAdvertisedConnectorTools, mergeConnectorToolPreview } from '@jini-ai/ui-core';
import { CONNECTOR_TOOL_PREVIEW_LIMIT } from '@jini-ai/ui-core';

export interface UseConnectorDetailParams {
  connectors: Connector[];
  setConnectors: Dispatch<SetStateAction<Connector[]>>;
  /** Gates tool-preview hydration (e.g. the host's provider must be configured). */
  unlocked: boolean;
  /** Changes whenever a previously-failed preview fetch should be retried (e.g. catalog refresh). */
  retryToken: string;
  /** Page size requested per tool-preview fetch. Defaults to {@link CONNECTOR_TOOL_PREVIEW_LIMIT}. */
  toolsLimit?: number;
}

export interface ConnectorDetailController {
  detailConnectorId: string | null;
  detailConnector: Connector | null;
  toolPreviewLoading: boolean;
  toolsLoaded: boolean;
  openDetails: (connectorId: string) => void;
  closeDetails: () => void;
  loadMoreTools: (connectorId: string, cursor?: string) => Promise<void>;
}

/** Owns the detail drawer's open/close state and its paginated tool-preview hydration. */
export function useConnectorDetail(port: ConnectorsPort, params: UseConnectorDetailParams): ConnectorDetailController {
  const { connectors, setConnectors, unlocked, retryToken, toolsLimit = CONNECTOR_TOOL_PREVIEW_LIMIT } = params;
  const [detailConnectorId, setDetailConnectorId] = useState<string | null>(null);
  const [loadingIds, setLoadingIds] = useState<Record<string, boolean>>({});
  const [fetchedIds, setFetchedIds] = useState<Record<string, boolean>>({});
  const [failedIds, setFailedIds] = useState<Record<string, string>>({});

  const detailConnector = useMemo(
    () => (detailConnectorId ? connectors.find((c) => c.id === detailConnectorId) ?? null : null),
    [detailConnectorId, connectors],
  );

  const hydrateToolPreview = useCallback(
    async (connectorId: string, cursor?: string) => {
      if (!unlocked) return;
      if (loadingIds[connectorId]) return;
      setLoadingIds((curr) => ({ ...curr, [connectorId]: true }));
      try {
        const next = await port.fetchConnectorDetail(connectorId, {
          hydrateTools: true,
          toolsLimit,
          ...(cursor === undefined ? {} : { toolsCursor: cursor }),
        });
        if (next) {
          setConnectors((curr) => curr.map((c) => (c.id === next.id ? mergeConnectorToolPreview(c, next, cursor !== undefined) : c)));
          setFetchedIds((curr) => ({ ...curr, [connectorId]: true }));
          setFailedIds((curr) => {
            if (curr[connectorId] === undefined) return curr;
            const nextFailed = { ...curr };
            delete nextFailed[connectorId];
            return nextFailed;
          });
        } else {
          setFailedIds((curr) => ({ ...curr, [connectorId]: retryToken }));
        }
      } catch {
        setFailedIds((curr) => ({ ...curr, [connectorId]: retryToken }));
      } finally {
        setLoadingIds((curr) => ({ ...curr, [connectorId]: false }));
      }
    },
    [unlocked, loadingIds, port, setConnectors, retryToken, toolsLimit],
  );

  useEffect(() => {
    if (!detailConnector) return;
    if (!unlocked) return;
    if (hasLoadedAllAdvertisedConnectorTools(detailConnector)) return;
    if (fetchedIds[detailConnector.id]) return;
    if (failedIds[detailConnector.id] === retryToken) return;
    if (loadingIds[detailConnector.id]) return;
    void hydrateToolPreview(detailConnector.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, detailConnector, failedIds, fetchedIds, loadingIds, retryToken]);

  const openDetails = useCallback((connectorId: string) => {
    setFailedIds((curr) => {
      if (curr[connectorId] === undefined) return curr;
      const next = { ...curr };
      delete next[connectorId];
      return next;
    });
    setDetailConnectorId(connectorId);
  }, []);

  const closeDetails = useCallback(() => setDetailConnectorId(null), []);

  const toolsLoaded = detailConnector
    ? Boolean(fetchedIds[detailConnector.id]) ||
      failedIds[detailConnector.id] === retryToken ||
      hasLoadedAllAdvertisedConnectorTools(detailConnector)
    : false;

  return {
    detailConnectorId,
    detailConnector,
    toolPreviewLoading: detailConnector ? Boolean(loadingIds[detailConnector.id]) : false,
    toolsLoaded,
    openDetails,
    closeDetails,
    loadMoreTools: hydrateToolPreview,
  };
}
