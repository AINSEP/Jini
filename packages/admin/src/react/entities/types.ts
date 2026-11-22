import type { AdminErasedEntityPort } from '../../core/ports/entities.js';
import type { EntityFailureView } from './FailureNotice.js';

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
  /**
   * A value the host changes when the data may have changed behind the screen's back (an assistant edited
   * a row, another tab saved). A changed token reads again, once; the same token never does.
   */
  readonly refreshToken?: unknown;
}

export interface EntityListProps extends EntityScreenDependencies {
  readonly entityName: string;
  readonly limitParam: string | null;
  /** Free text handed to the port's `list` as `search` on every page; null or empty sends none. */
  readonly search?: string | null | undefined;
}

export interface EntityDetailProps extends EntityScreenDependencies {
  readonly entityName: string;
  readonly id: string;
}

export interface EntityEditProps extends EntityScreenDependencies {
  readonly entityName: string;
  /** Null creates a row. All string ids, including `new`, refer to saved rows. */
  readonly id: string | null;
  /**
   * Host words for a rejected save or delete. Receives the error exactly as the port threw it. Default:
   * "Operation failed" plus the error text under Details and a Copy details button.
   */
  readonly describeFailure?: (required: { readonly error: unknown }) => EntityFailureView;
  /** Puts text on the clipboard for Copy details. Default: the browser clipboard. */
  readonly copyText?: (required: { readonly text: string }) => Promise<void>;
}

/** Stable source templates let host dictionaries translate copy before values are inserted. */
export function entityText(
  { translate, key, values }: { readonly translate: EntityTranslate; readonly key: string; readonly values: Readonly<Record<string, string | number>> },
): string {
  return translate({ key: key }).replace(/\{(\w+)\}/g, (match, name: string) =>
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
