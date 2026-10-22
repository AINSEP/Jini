import type { AdminErasedEntityPort } from '../../core/ports/entities.js';

/** Resolves existing entity ports; replace the registry object when registrations change. */
export interface EntityRegistryPort {
  listEntities(args: Record<string, never>): readonly AdminErasedEntityPort[];
  getEntity(args: { readonly name: string }): AdminErasedEntityPort | null;
}

export type EntityTranslate = (args: { readonly key: string }) => string;
export interface EntityRouteTarget {
  readonly entity?: string;
  readonly id?: string;
  readonly view?: 'list' | 'detail' | 'edit' | 'create';
}

export interface EntityRoutesPort {
  href(args: EntityRouteTarget): string;
  navigate(args: EntityRouteTarget): void;
}

export interface EntityScreenDependencies {
  readonly registry: EntityRegistryPort;
  readonly translate: EntityTranslate;
  readonly routes: EntityRoutesPort;
}

export interface EntityListProps extends EntityScreenDependencies {
  readonly entityName: string;
  readonly limitParam: string | null;
}

export interface EntityDetailProps extends EntityScreenDependencies {
  readonly entityName: string;
  readonly id: string;
}

export interface EntityEditProps extends EntityScreenDependencies {
  readonly entityName: string;
  /** Null creates a row. All string ids, including `new`, refer to saved rows. */
  readonly id: string | null;
}

/** Stable source templates let host dictionaries translate copy before values are inserted. */
export function entityText(
  { translate, key, values }: { readonly translate: EntityTranslate; readonly key: string; readonly values: Readonly<Record<string, string | number>> },
): string {
  return translate({ key: key }).replace(/\{([\w]+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match);
}

/**
 * Adapts the host's object-arg {@link EntityTranslate} to the positional `(key) => string` form the
 * shared `Select` widget takes. One adapter for every `Select` an entity form renders, so each one
 * routes its own copy (search box, empty state) through the host dictionary — even the short boolean
 * select, which never shows that copy today.
 */
export function selectTranslate({ translate }: { readonly translate: EntityTranslate }): (key: string) => string {
  return (key) => translate({ key });
}
