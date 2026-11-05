import { buildDomainRegistrations, indexCatalogById, type AgentToolDefinition, type DerivedRiskByToolId, type ToolRegistration } from "@jini-ai/core";
import { nowIso, type Clock, type IdGenerator } from "@jini-ai/core/primitives";
import { adaptLegacyAuthorize, requireToolPermission, type AuthorizeFn } from "@jini-ai/cms/core";
import { CommerceProductNotFoundError } from "./catalog/errors.js";
import { CommerceUnavailableError, type CommerceServer } from "./catalog/plugin-server.js";
import type { CommercePriceRepoPort, CommerceProductRepoPort } from "./catalog/ports.js";
import { readAmount, requiredText, strictInput } from "./payments/tools/input.js";
import { ToolInputError } from "@jini-ai/core";

export interface CommerceCatalogToolsDeps {
  workspaceId: string;
  authorize: AuthorizeFn;
  commerce: Pick<CommerceServer, "activate">;
  products: CommerceProductRepoPort;
  prices: CommercePriceRepoPort;
  clock: Clock;
  idGen: IdGenerator;
}
const permission = "admin.integrations.manage";
const STOREFRONT_LIMIT_WARNING = "The storefront grid shows at most 24 priced products. This catalog has more than 24 active products; use each product’s direct /products/<slug> link for products beyond the grid.";
export const commerceCatalogToolCatalog: AgentToolDefinition[] = [{
  name: "commerce_create_product", description: "Creates one active catalog product. Add a one-time price with commerce_create_price before offering checkout. Does not move money.",
  sideEffects: "mutates-durable-state", authorization: { permission },
  inputSchema: { type: "object", additionalProperties: false, required: ["name", "slug"], properties: {
    name: { type: "string", minLength: 1, maxLength: 200 }, slug: { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
  } },
}, {
  name: "commerce_create_price", description: "Creates one one-time price for an active product and archives its older active prices. amount is integer minor units and an uppercase ISO currency (JPY has no decimal units). Does not move money or alter existing order prices.",
  sideEffects: "mutates-durable-state", authorization: { permission },
  inputSchema: { type: "object", additionalProperties: false, required: ["productId", "amount"], properties: {
    productId: { type: "string", minLength: 1, maxLength: 200 }, amount: { type: "object", additionalProperties: false, required: ["minorUnits", "currency"], properties: {
      minorUnits: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, currency: { type: "string", pattern: "^[A-Z]{3}$" },
    } },
  } },
}];
export const commerceCatalogDerivedRisk: DerivedRiskByToolId = new Map([
  ["commerce_create_product", "mutates-durable-state"], ["commerce_create_price", "mutates-durable-state"],
]);

/** Authorization precedes activation/migration; disabled commerce cannot create new catalog rows. */
async function requireSetup({ deps, principalId }: { deps: CommerceCatalogToolsDeps; principalId: string }): Promise<void> {
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId, permission }, { entityType: "integration" });
  const status = await deps.commerce.activate();
  if (status.scope.workspaceId !== deps.workspaceId) throw new CommerceUnavailableError("Commerce is configured for another workspace.");
  if (!status.ready) throw new CommerceUnavailableError(status.reason ?? "Commerce catalog is temporarily unavailable.");
}

/** Bounded setup-time warning: no per-product price queries or pagination is introduced. */
async function storefrontWarnings({ products, workspaceId }: Pick<CommerceCatalogToolsDeps, 'products' | 'workspaceId'>): Promise<{ warnings?: string[] }> {
  try {
    const active = await products.listActive({ workspaceId, limit: 25 });
    return active.length > 24 ? { warnings: [STOREFRONT_LIMIT_WARNING] } : {};
  } catch {
    return { warnings: ['The catalog record was saved. The storefront size could not be checked; the grid shows at most 24 priced products, and direct product links remain available.'] };
  }
}

/**
 * Setup tools create new records; prices are never updated underneath purchase-time snapshots.
 * @complexity O(1): scoped record work plus one bounded read of at most 25 active products.
 */
export function buildCommerceCatalogRegistrations(deps: CommerceCatalogToolsDeps, _optional: Record<string, never> = {}): ToolRegistration[] {
  return buildDomainRegistrations({ domain: "commerce-catalog", catalogModule: "commerce/catalog-tools.ts",
    catalog: indexCatalogById({ catalog: commerceCatalogToolCatalog }), derivedRisk: commerceCatalogDerivedRisk,
    handlers: {
      commerce_create_product: async ctx => {
        await requireSetup({ deps, principalId: ctx.principal.id });
        const input = strictInput({ input: ctx.input, allowed: ["name", "slug"] });
        const name = requiredText({ input, key: "name" }, { max: 200 });
        const slug = requiredText({ input, key: "slug" }, { max: 100 });
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new ToolInputError({ message: "slug must contain lowercase words separated by single hyphens" });
        const at = nowIso({ clock: deps.clock });
        const product = { id: deps.idGen.newId(), workspaceId: deps.workspaceId, name, slug, kind: "one_time" as const, status: "active" as const, createdAt: at, updatedAt: at, version: 1 };
        await deps.products.save(product);
        return { product, ...await storefrontWarnings(deps) };
      },
      commerce_create_price: async ctx => {
        await requireSetup({ deps, principalId: ctx.principal.id });
        const input = strictInput({ input: ctx.input, allowed: ["productId", "amount"] });
        const productId = requiredText({ input, key: "productId" }, { max: 200 });
        const unitAmount = readAmount({ input });
        const product = await deps.products.findById({ workspaceId: deps.workspaceId, id: productId });
        if (!product || product.workspaceId !== deps.workspaceId || product.status !== "active") throw new CommerceProductNotFoundError("Active product was not found in this workspace.");
        const price = { id: deps.idGen.newId(), workspaceId: deps.workspaceId, productId, unitAmount, status: "active" as const, createdAt: nowIso({ clock: deps.clock }), version: 1 };
        await deps.prices.save(price);
        return { price, ...await storefrontWarnings(deps) };
      },
    },
  });
}
