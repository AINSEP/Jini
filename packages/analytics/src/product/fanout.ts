import type { ProductAnalyticsPort } from "./index.js";

/** Fans product events out to every configured analytics port (normally one), isolating failures
 * and each provider's content opt-in. @complexity O(p) per event for p configured providers. */
export function fanOutProductAnalytics({ ports }: { ports: readonly ProductAnalyticsPort[] }, { onFailure }: { onFailure?: () => void } = {}): ProductAnalyticsPort {
  const failed = () => { try { onFailure?.(); } catch { /* Diagnostics never fail product work. */ } };
  const each = (send: (port: ProductAnalyticsPort) => void | Promise<void>): Promise<void> => {
    const admissions = ports.map(port => {
      try { return Promise.resolve(send(port)).catch(failed); }
      catch { failed(); /* one vendor never blocks another */ return Promise.resolve(); }
    });
    return Promise.all(admissions).then(() => {});
  };
  return {
    capture: (event) => each((port) => port.capture(event)), identify: (identity) => each((port) => port.identify(identity)),
    get includeAiContent() { return ports.some((port) => port.captureAiGeneration && port.includeAiContent === true); },
    ...(ports.some((port) => port.captureAiGeneration) ? {
      captureAiGeneration: (event: Parameters<NonNullable<ProductAnalyticsPort["captureAiGeneration"]>>[0]) => each((port) => {
        // Each provider owns its opt-in, even when another provider requests content.
        // Recheck even a single provider: its policy can rotate during async consent.
        const { input: _input, output: _output, ...metadata } = event;
        port.captureAiGeneration?.(port.includeAiContent === true ? event : metadata);
      }),
    } : {}),
  };
}

