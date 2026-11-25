import type { ReactElement } from "react";
import { agentHandle } from "@jini-ai/core/agent-handles";
import type { ProviderSummary } from "../payments/contract/payments-port.js";
import { usePayments } from "./Payments.hooks.js";

/**
 * @file Provider-neutral Payments overview for the Commerce admin area.
 *
 * Open SaaS makes the payment journey understandable by putting provider setup, pricing,
 * checkout, subscription management, and revenue reporting next to one another. The host does not
 * yet expose an approved Commerce admin read model or money-movement operation, so this first
 * slice ports that information architecture only. Every state is intentionally static and honest:
 * adapters stay outside the feature, no readiness is inferred, and no metric is fabricated.
 */

export interface PaymentsClasses {
  readonly page: string;
  readonly pageHeader: string;
  readonly pageHeaderText: string;
  readonly pageKicker: string;
  readonly pageTitle: string;
  readonly pageDescription: string;
  readonly notice: string;
  readonly panels: string;
  readonly panel: string;
  readonly panelHead: string;
  readonly panelTitle: string;
  readonly panelBody: string;
  readonly actions: string;
  readonly disabledStatus: string;
  readonly secondaryButton: string;
}

/**
 * Renders the read-only starting point for the host payment journey.
 *
 * @returns Host-supplied provider labels, Commerce links, and explicit backend-boundary copy.
 * @example
 * ```tsx
 * <Payments classes={classes} usePaymentsHook={usePayments} />
 * ```
 * @complexity O(n) time and space for n supplied provider summaries; no I/O.
 */
export function Payments({ locale = "en", providers = [], usePaymentsHook, classes }: {
  locale?: (string) | undefined; providers?: readonly ProviderSummary[]; usePaymentsHook: typeof usePayments; classes: PaymentsClasses;
}): ReactElement {
  const t = usePaymentsHook({ locale });
  return (
    <div className={classes.page}>
      <div className={classes.pageHeader}>
        <div className={classes.pageHeaderText}>
          <p className={classes.pageKicker}>{t("Commerce")}</p>
          <h1 className={classes.pageTitle}>{t("Payments")}</h1>
          <p className={classes.pageDescription}>
            {t("Set up how this store charges, renews, and reports without tying Commerce to one payment processor.")}
          </p>
        </div>
      </div>

      <div className={classes.notice}>
        {t("The Commerce read model is not connected yet. This overview shows the intended workflow without claiming that payment operations or reporting are ready.")}
      </div>

      <div className={classes.panels}>
        {renderPaymentProviders(t, providers, classes)}

        {renderCatalogPricing(t, classes)}

        {renderCheckoutOrders(t, classes)}

        {renderRevenueReporting(t, classes)}
      </div>
    </div>
  );
}

function renderPaymentProviders(t: ReturnType<typeof usePayments>, providers: readonly ProviderSummary[], classes: Pick<PaymentsClasses, "panel" | "panelHead" | "panelTitle" | "disabledStatus" | "panelBody" | "actions">): ReactElement {
  return (
    <section className={classes.panel} aria-labelledby="commerce-payment-providers">
      <div className={classes.panelHead}>
        <h2 className={classes.panelTitle} id="commerce-payment-providers">
          {t("Payment providers")}
        </h2>
        <span className={classes.disabledStatus}>{t("Setup required")}</span>
      </div>
      <div className={classes.panelBody}>
        <p>
          {t("Provider adapters remain separate from Commerce. Connectors can change without changing the payment journey shown here.")}
        </p>
        <div className={classes.actions} aria-label={t("Planned payment provider adapters")}>
          {providers.map(provider => <span key={provider.id} className={classes.disabledStatus}>{provider.displayName}</span>)}
        </div>
      </div>
    </section>
  );
}

function renderCatalogPricing(t: ReturnType<typeof usePayments>, classes: Pick<PaymentsClasses, "panel" | "panelHead" | "panelTitle" | "disabledStatus" | "panelBody" | "actions" | "secondaryButton">): ReactElement {
  return (
    <section className={classes.panel} aria-labelledby="commerce-catalog-pricing">
      <div className={classes.panelHead}>
        <h2 className={classes.panelTitle} id="commerce-catalog-pricing">
          {t("Catalog and pricing")}
        </h2>
        <span className={classes.disabledStatus}>{t("Planned")}</span>
      </div>
      <div className={classes.panelBody}>
        <p>
          {t("Products, one-time prices, recurring plans, and the customer subscription lifecycle remain separate Commerce capabilities.")}
        </p>
        <div className={classes.actions}>
          <a
            className={classes.secondaryButton}
            href="/admin/products"
            {...agentHandle({ handle: "payments-open-products" }, { role: "link", label: "Go to Products" })}
          >
            {t("Open products")}
          </a>
          <a
            className={classes.secondaryButton}
            href="/admin/subscriptions"
            {...agentHandle({ handle: "payments-open-subscriptions" }, { role: "link", label: "Go to Subscriptions" })}
          >
            {t("Open subscriptions")}
          </a>
        </div>
      </div>
    </section>
  );
}

function renderCheckoutOrders(t: ReturnType<typeof usePayments>, classes: Pick<PaymentsClasses, "panel" | "panelHead" | "panelTitle" | "disabledStatus" | "panelBody" | "actions" | "secondaryButton">): ReactElement {
  return (
    <section className={classes.panel} aria-labelledby="commerce-checkout-orders">
      <div className={classes.panelHead}>
        <h2 className={classes.panelTitle} id="commerce-checkout-orders">
          {t("Checkout and orders")}
        </h2>
        <span className={classes.disabledStatus}>{t("Planned")}</span>
      </div>
      <div className={classes.panelBody}>
        <p>
          {t("Checkout sessions, operation receipts, and provider webhook reconciliation require the approved plan/execute backend boundary before this screen can operate them.")}
        </p>
        <div className={classes.actions}>
          <a
            className={classes.secondaryButton}
            href="/admin/orders"
            {...agentHandle({ handle: "payments-open-orders" }, { role: "link", label: "Go to Orders" })}
          >
            {t("Open orders")}
          </a>
        </div>
      </div>
    </section>
  );
}

function renderRevenueReporting(t: ReturnType<typeof usePayments>, classes: Pick<PaymentsClasses, "panel" | "panelHead" | "panelTitle" | "disabledStatus" | "panelBody">): ReactElement {
  return (
    <section className={classes.panel} aria-labelledby="commerce-revenue-reporting">
      <div className={classes.panelHead}>
        <h2 className={classes.panelTitle} id="commerce-revenue-reporting">
          {t("Revenue reporting")}
        </h2>
        <span className={classes.disabledStatus}>{t("Awaiting read model")}</span>
      </div>
      <div className={classes.panelBody}>
        <p>
          {t("No revenue totals or trends are shown until a Commerce projection has an approved contract and real source data.")}
        </p>
      </div>
    </section>
  );
}
