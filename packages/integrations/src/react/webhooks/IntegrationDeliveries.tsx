import type { ComponentType, ReactNode } from "react";
import type { AdminWebhookDeliveryResponse } from "@jini-ai/core/contracts/site/cms-integrations";
import { displayTimestamp } from "./rules.js";
import type { IntegrationDeliveriesController } from "./hooks/use-integration-deliveries.hooks.js";

/**
 * @file The webhook delivery-log screen — markup only.
 *
 * State and API calls live in `hooks/use-integration-deliveries.hooks.ts`; the timestamp
 * derivation lives in `rules.ts`. What stays here is what actually renders: column definitions
 * and the empty state.
 */
type Empty = Record<string, never>;
export interface IntegrationDeliveriesProps {
  subscriptionId: string;
  /**
   * Dependency injection seam for tests — see `Integrations.tsx`'s `useIntegrationsHook` for the
   * house convention this follows.
   */
  useIntegrationDeliveriesHook: (required: { subscriptionId: string }, options?: Empty) => IntegrationDeliveriesController;
  kit: { DataTable: ComponentType<{
    rows: readonly AdminWebhookDeliveryResponse[];
    rowKey: (row: AdminWebhookDeliveryResponse, index: number) => string;
    empty: ReactNode;
    columns: readonly { key: string; header?: ReactNode; headerLabel?: string; cell: (row: AdminWebhookDeliveryResponse, index: number) => ReactNode }[];
  }> };
  ServerLabel: ComponentType<{ value: string }>;
  viewerTimeZone: string;
}

export function IntegrationDeliveries({
  subscriptionId,
  useIntegrationDeliveriesHook,
  kit: { DataTable },
  ServerLabel,
  viewerTimeZone,
}: IntegrationDeliveriesProps) {
  const { deliveries, error, t } = useIntegrationDeliveriesHook({ subscriptionId });

  if (error) return <div className="notice error">{error}</div>;
  if (!deliveries) return <div className="notice">{t({ key: "Loading delivery log…" })}</div>;

  return (
    <div className="page">
      <a href="/admin/addons/integrations?tab=webhooks">{t({ key: "← Integrations" })}</a>
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">{t({ key: "Integrations" })}</p>
          <h1 className="page-title">{t({ key: "Delivery log" })}</h1>
          <p className="page-description">{t({ key: "Every delivery attempt logged for this webhook subscription." })}</p>
        </div>
      </div>
      <DataTable
        rows={deliveries}
        rowKey={(delivery) => delivery.id}
        empty={
          <div className="card">
            <div className="empty-state">
              <p>{t({ key: "No deliveries yet for this subscription." })}</p>
            </div>
          </div>
        }
        columns={[
          {
            key: "status",
            header: t({ key: "Status" }),
            cell: (delivery) => (
              <span className={`status status-delivery-${delivery.status}`}><ServerLabel value={delivery.status} /></span>
            ),
          },
          { key: "attempts", header: t({ key: "Attempts" }), cell: (delivery) => delivery.attempts },
          {
            key: "last-response",
            header: t({ key: "Last response" }),
            cell: (delivery) => (
              <>
                {delivery.lastResponseStatus ?? "—"}
                {delivery.lastError ? <div className="save-error">{delivery.lastError}</div> : null}
              </>
            ),
          },
          { key: "timestamp", header: t({ key: "Timestamp" }), cell: (delivery) => displayTimestamp({ delivery, viewerTimeZone }, {}) },
        ]}
      />
    </div>
  );
}
