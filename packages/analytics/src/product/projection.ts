/**
 * @file Catalog projection for product events: keep only the properties a host-declared catalog
 * allows, and replace all caller identity with the installation identity. The catalog itself (event
 * names, closed vocabularies, call-site inventory) is host product policy and is passed in.
 */
import type { ProductEvent, ProductEventProperties } from '@jini-ai/core/contracts/observability';

/** One declared property: a closed string vocabulary, or a typed scalar with no enum. */
export type ProductEventRule = readonly string[] | 'boolean' | 'number';
/** Declared properties of one event name. */
export type ProductEventRules = Readonly<Record<string, ProductEventRule>>;
/** Event name -> declared properties. IDs, tool names, target names and text should have no rule:
 * open catalogs (installed plugins, deploy targets) are not product labels. */
export type ProductEventCatalog = Readonly<Record<string, ProductEventRules>>;

/** Freeze a host catalog at every level (catalog, per-event rules, enum arrays).
 * @returns A fresh frozen catalog. @complexity O(r) declared rules. */
export function freezeProductEventCatalog({ catalog }: { catalog: Record<string, Record<string, ProductEventRule>> }, _optional = {}): ProductEventCatalog {
  return Object.freeze(Object.fromEntries(Object.entries(catalog).map(([name, rules]) => [name, Object.freeze(Object.fromEntries(Object.entries(rules).map(([key, rule]) => [key, Array.isArray(rule) ? Object.freeze(rule) : rule])))])));
}

/** Check one declared value without coercion. @complexity O(e) in the small enum size. */
function allowedValue({ rule, value }: { rule: ProductEventRule; value: unknown }, _options = {}): boolean {
  if (rule === 'boolean') return typeof value === 'boolean';
  if (rule === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === 'string' && rule.includes(value);
}

/** Declared keys only; invalid enums are omitted, invalid booleans/numbers refuse the event.
 * @complexity O(k) declared keys.
 */
function declaredProperties({ rules, properties }: { rules: ProductEventRules; properties: ProductEvent['properties'] }, _options = {}): ProductEventProperties | undefined {
  const projected: Record<string, ProductEventProperties[string]> = {};
  for (const [key, rule] of Object.entries(rules)) {
    const value = properties?.[key];
    if (value === undefined) continue;
    if (allowedValue({ rule, value })) projected[key] = value;
    else if (!Array.isArray(rule)) return undefined;
    else { /* Invalid enum values are omitted. */ }
  }
  return projected;
}

/** Project only catalog properties and replace all caller identity with installation identity.
 * Unknown fields and invalid enum values are omitted; invalid booleans/numbers refuse the event.
 * @returns A fresh event, or undefined for unapproved names/values/identity. No effects.
 * @example projectDeclaredProductEvent({ event: { name: 'app_started', userId: 'ignored' }, installationId: 'fake-install', catalog });
 * @complexity O(k) declared keys, bounded by the frozen catalog; no caller-property scan.
 */
export function projectDeclaredProductEvent({ event, installationId, catalog }: { event: ProductEvent; installationId: string | null; catalog: ProductEventCatalog }, _optional = {}): ProductEvent | undefined {
  if (!installationId || !Object.hasOwn(catalog, event.name)) return undefined;
  const rules = catalog[event.name];
  if (!rules) throw new Error(`product event ${event.name} has no declared rules`);
  const properties = declaredProperties({ rules, properties: event.properties });
  return properties ? { name: event.name, userId: installationId, properties } : undefined;
}
