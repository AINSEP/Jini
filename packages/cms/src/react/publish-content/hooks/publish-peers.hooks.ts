import { useCallback, useEffect, useRef, useState } from "react";
import type { PublishContentPeerView, PublishDestinationView as AdminPublishDestinationView } from "@jini-ai/core/contracts/site/cms-publish-content";
import type { Translate } from "@jini-ai/core/text";
import type { PublishContentConnectOffer } from "./publish-confirm-view.js";
import { singlePublishPeerId } from "./publish-plan.hooks.js";
import type { usePublishLifecycle } from "./publish-lifecycle.hooks.js";
import type { usePublishPlanState, usePublishPlan } from "./publish-plan.hooks.js";

export function usePublishPeers(required: ReturnType<typeof usePublishLifecycle>, _optional = {}) {
  const { port, t } = required;

  // Load the target list before offering destination discovery for an empty install.
  const [peers, setPeers] = useState<readonly PublishContentPeerView[]>([]);
  const [peersLoaded, setPeersLoaded] = useState(false);
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [peersError, setPeersError] = useState<string | null>(null);

  // The empty state's connect offer — only ever populated when the peer list comes back empty (see
  // the effect below). `destination` and `destinationError` are mutually exclusive with each other,
  // same convention as `peers`/`peersError`.
  const [destination, setDestination] = useState<AdminPublishDestinationView | null>(null);
  const [destinationLoaded, setDestinationLoaded] = useState(false);
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const peerLoadTranslator = useRef(t);
  peerLoadTranslator.current = t;

    // `t` is read only for a fallback string and is deliberately NOT a dependency: a caller whose
    // translator is a fresh closure each render would otherwise refetch the peer list on every
    // render. The worst case is a fallback sentence in a stale locale.
  useEffect(() => loadPublishPeers({ ...required, peerLoadTranslator, setDestination, setDestinationError, setDestinationLoaded, setPeers, setSelectedPeerId, setPeersError, setPeersLoaded }), [port]);

  const connectOffer = publishConnectOffer({
    peersLoaded,
    peers,
    peersError,
    destinationLoaded,
    destination,
  });

  const [connecting, setConnecting] = useState(false);

  return { peers, setPeers, peersLoaded, selectedPeerId, setSelectedPeerId, peersError, destination, destinationLoaded, destinationError, setDestinationError, connectOffer, connecting, setConnecting };
}

export function usePublishConnect(required: ReturnType<typeof usePublishLifecycle> & ReturnType<typeof usePublishPeers> & ReturnType<typeof usePublishPlanState> & ReturnType<typeof usePublishPlan>, _optional = {}) {
  const { setConnecting, setDestinationError, port, live, t, setPeers, setSelectedPeerId, requestPlan, deps } = required;
  const { describeApiError } = deps;
  // The connect action behind the empty state — `destination.ts`'s header explains why it lives
  // here rather than on a settings screen. Success folds the newly connected site straight into
  // `peers`/`selectedPeerId` and moves on to planning immediately: the operator asked to publish,
  // not to "connect", so the one extra click stays inside the same flow rather than landing back on
  // a now-idle dialog they'd have to press Publish on again.
  // Re-entry is already blocked one level up: `onConnect` is only reached through `onPrimary`, whose
  // `primaryInFlightRef` holds until this promise settles (and `connecting` is reset before it does),
  // so a second press can never land while a connect runs.
  const onConnect = useCallback(async () => {
    setConnecting(true);
    setDestinationError(null);
    try {
      const view = await port.connectDestination({});
      if (!live.current) return;
      if (view.site === null) {
        // Contract violation, not a user-facing failure mode: `destination.ts`'s `/connect` always
        // returns a site on success. Guarded rather than assumed so a server regression here shows
        // up as a sentence instead of a crash.
        setDestinationError(t("Could not connect."));
        setConnecting(false);
        return;
      }
      const { site } = view;
      setPeers([site]);
      setSelectedPeerId(site.id);
      setConnecting(false);
      void requestPlan(site.id);
    } catch (error) {
      if (!live.current) return;
      setDestinationError(describeApiError({ e: error, fallback: t("Could not connect.") }));
      setConnecting(false);
    }
  }, [port, requestPlan, t]);

  return { onConnect };
}

function loadPublishPeers(required: ReturnType<typeof usePublishLifecycle> & {
  setDestinationError: (value: string | null) => void;
  setPeers: (value: readonly PublishContentPeerView[]) => void;
  setSelectedPeerId: (value: string | null) => void;
  peerLoadTranslator: { current: Translate };
  setDestination: (value: AdminPublishDestinationView) => void;
  setDestinationLoaded: (value: boolean) => void;
  setPeersError: (value: string) => void;
  setPeersLoaded: (value: boolean) => void;
}, _optional = {}) {
  const { port, live, peerLoadTranslator, setDestination, setDestinationError, setDestinationLoaded, deps } = required;
  const { describeApiError } = deps;

    const t = peerLoadTranslator.current;
    let cancelled = false;
    const readDestination = async (_required: Record<string, never>, _options: Record<string, never> = {}) => {
      try {
        const view = await port.getDestination();
        if (cancelled || !live.current) return;
        setDestination(view);
      } catch (destinationErr) {
        if (cancelled || !live.current) return;
        setDestinationError(
          describeApiError({ e: destinationErr, fallback: t("Could not check whether this install can publish yet.") })
        );
      } finally {
        if (!cancelled && live.current) setDestinationLoaded(true);
      }
    };
    void readPublishPeers({ ...required, t, isCancelled: () => cancelled, readDestination });

    return () => {
      cancelled = true;
    };

}

async function readPublishPeers(required: Parameters<typeof loadPublishPeers>[0] & {
  t: Translate; isCancelled: () => boolean;
  readDestination: (required: Record<string, never>, optional?: Record<string, never>) => Promise<void>;
}, _optional = {}) {
  const { port, live, setPeers, setSelectedPeerId, setPeersError, setPeersLoaded, t, isCancelled, readDestination, deps } = required;
  const { describeApiError } = deps;

      try {
        const { peers: loaded } = await port.listPeers();
        if (isCancelled() || !live.current) return;
        setPeers(loaded);
        // Auto-select when there is exactly one target: the overwhelmingly common case is a single
        // production peer, and making the operator pick it from a list of one is friction with no
        // decision behind it. With two or more, the dialog asks.
        setSelectedPeerId(singlePublishPeerId(loaded));
        // Nothing to publish to yet — check whether this install can offer a one-click connect
        // instead of failing shut. Sequenced after `listPeers` rather than fired in parallel: the
        // common case (already connected) never needs this second call at all.
        if (loaded.length === 0) {
          await readDestination({});
        }
      } catch (error) {
        if (isCancelled() || !live.current) return;
        setPeersError(describeApiError({ e: error, fallback: t("Could not load publish targets.") }));
      } finally {
        if (!isCancelled() && live.current) setPeersLoaded(true);
      }

}

/** The empty-install connection offer, once both discovery reads have settled successfully. */
function publishConnectOffer(
  { peersLoaded, peers, peersError, destinationLoaded, destination }: {
    peersLoaded: boolean;
    peers: readonly PublishContentPeerView[];
    peersError: string | null;
    destinationLoaded: boolean;
    destination: AdminPublishDestinationView | null;
  },
  _options: Record<string, never> = {}
): PublishContentConnectOffer | null {
  // `null` until BOTH the peer list came back empty and the destination check that follows it has
  // resolved — so the dialog never flashes a stale "add one in Settings" sentence, and never shows
  // the connect offer a beat before it has anything real to say.
  const noPeers = peersLoaded && peers.length === 0 && peersError === null;
  if (!noPeers || !destinationLoaded || destination === null) return null;
  return { message: destination.message, candidateUrl: destination.candidateUrl };
}
