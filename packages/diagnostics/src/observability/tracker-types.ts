import type { ObservabilityPort } from "@jini-ai/core/contracts/observability";
import type { CaptureEvent } from "@jini-ai/core/contracts/site/diagnostics-observability";

interface CapturePort {
  capture(event: CaptureEvent): void | Promise<void>;
  /** Retained for existing provider literals; the tracker never identifies users. */
  identify?(identity: { userId: string; traits?: CaptureEvent['properties'] }): void;
}

export interface TrackerProviders {
  /** Already guarded by the host's existing consent policy; never guard a second time. */
  productAnalytics?: CapturePort | undefined;
  observability?: ObservabilityPort | undefined;
}
export interface TrackerOptions { warn?: ((message: string) => void) | undefined; }
