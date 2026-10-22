import type { ReactElement } from "react";
import { agentHandle } from "@jini-ai/agentic";
import { t as translateCommerce } from "./commerce-i18n.js";

/**
 * @file Provider-neutral Payments overview for the Commerce admin area.
 *
 * Open SaaS makes the payment journey understandable by putting provider setup, pricing,
 * checkout, subscription management, and revenue reporting next to one another. The host does not
 * yet expose an approved Commerce admin read model or money-movement operation, so this first
 * slice ports that information architecture only. Every state is intentionally static and honest:
 * adapters stay outside the feature, no readiness is inferred, and no metric is fabricated.
 */

/**
 * Renders the read-only starting point for the host payment journey.
 *
 * @returns Provider labels, links to existing Commerce routes, and explicit backend-boundary copy.
 * @example
 * ```tsx
 * <Payments />
 * ```
 * @complexity O(1) time and space; the screen renders a fixed capability set with no I/O.
 */
export function Payments({ locale = "en" }: { locale?: (string) | undefined } = {}): ReactElement {
  const t = (key: string): string => translateCommerce({ locale, key });
  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">{t("Commerce")}</p>
          <h1 className="page-title">{t("Payments")}</h1>
          <p className="page-description">
            {t("Set up how this store charges, renews, and reports without tying Commerce to one payment processor.")}
          </p>
        </div>
      </div>

      <div className="notice">
        {t("The Commerce read model is not connected yet. This overview shows the intended workflow without claiming that payment operations or reporting are ready.")}
      </div>

      <div className="dash-panels">
        <section className="dash-panel" aria-labelledby="commerce-payment-providers">
          <div className="dash-panel-head">
            <h2 className="dash-panel-title" id="commerce-payment-providers">
              {t("Payment providers")}
            </h2>
            <span className="status status-disabled">{t("Setup required")}</span>
          </div>
          <div className="dash-panel-body">
            <p>
              {t("Provider adapters remain separate from Commerce. Connectors can change without changing the payment journey shown here.")}
            </p>
            <div className="page-actions" aria-label={t("Planned payment provider adapters")}>
              <span className="status status-disabled">Stripe</span>
              <span className="status status-disabled">PayPal</span>
            </div>
          </div>
        </section>

        <section className="dash-panel" aria-labelledby="commerce-catalog-pricing">
          <div className="dash-panel-head">
            <h2 className="dash-panel-title" id="commerce-catalog-pricing">
              {t("Catalog and pricing")}
            </h2>
            <span className="status status-disabled">{t("Planned")}</span>
          </div>
          <div className="dash-panel-body">
            <p>
              {t("Products, one-time prices, recurring plans, and the customer subscription lifecycle remain separate Commerce capabilities.")}
            </p>
            <div className="page-actions">
              <a
                className="btn-secondary"
                href="/admin/products"
                {...agentHandle({ handle: "payments-open-products" }, { role: "link", label: "Go to Products" })}
              >
                {t("Open products")}
              </a>
              <a
                className="btn-secondary"
                href="/admin/subscriptions"
                {...agentHandle({ handle: "payments-open-subscriptions" }, { role: "link", label: "Go to Subscriptions" })}
              >
                {t("Open subscriptions")}
              </a>
            </div>
          </div>
        </section>

        <section className="dash-panel" aria-labelledby="commerce-checkout-orders">
          <div className="dash-panel-head">
            <h2 className="dash-panel-title" id="commerce-checkout-orders">
              {t("Checkout and orders")}
            </h2>
            <span className="status status-disabled">{t("Planned")}</span>
          </div>
          <div className="dash-panel-body">
            <p>
              {t("Checkout sessions, operation receipts, and provider webhook reconciliation require the approved plan/execute backend boundary before this screen can operate them.")}
            </p>
            <div className="page-actions">
              <a
                className="btn-secondary"
                href="/admin/orders"
                {...agentHandle({ handle: "payments-open-orders" }, { role: "link", label: "Go to Orders" })}
              >
                {t("Open orders")}
              </a>
            </div>
          </div>
        </section>

        <section className="dash-panel" aria-labelledby="commerce-revenue-reporting">
          <div className="dash-panel-head">
            <h2 className="dash-panel-title" id="commerce-revenue-reporting">
              {t("Revenue reporting")}
            </h2>
            <span className="status status-disabled">{t("Awaiting read model")}</span>
          </div>
          <div className="dash-panel-body">
            <p>
              {t("No revenue totals or trends are shown until a Commerce projection has an approved contract and real source data.")}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
