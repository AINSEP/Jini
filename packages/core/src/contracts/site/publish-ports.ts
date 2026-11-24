/**
 * @file The product-neutral shape of a publish engine's port bag.
 *
 * A publish engine is generic over the bag a host hands it: it never reads a field of it, it only
 * passes `deps.ports` on to the handler each registered type builds. The bag is the one place that
 * names what a site's publishable types need, so the engine's own files import nothing from the
 * post, media, navigation, taxonomy, entries, content-type or theme features.
 *
 * ## One typed bag, keyed by `entityType`
 *
 * Every registered type used to widen the engine's deps with its own flat, individually-optional
 * field (`mediaRepo`, `redirectsWriteDeps`, `menuRepo`, `navLocationBindingRepo`, …), each threaded
 * by hand through the routes, the tool registrations and every composition root. A type could ship
 * with a real `apply()` before it could actually travel, because every one of those builders forgot
 * some of the fields and nothing complained: the fields were OPTIONAL, so a missing one silently
 * degraded `pack`/`inspect`/`precheck` to "nothing to report" instead of failing anywhere.
 *
 * {@link PublishPorts} replaces that with ONE type, one key per registered `entityType`, so a root
 * that forgets a type's ports is a type error at exactly one place instead of an N-file scavenger
 * hunt. Each key's value is that type's own slice, exhaustive for that type, so a root that does
 * supply a slice can no longer misspell or half-supply one of its fields. The engine's `ports`
 * argument may still be `Partial` — a caller that only ever exports/plans (never applies) has no use
 * for supplying every type's ports — which is why this contract stays a plain mapped type and leaves
 * optionality to the consumer.
 *
 * This package owns only the keyed-bag shape. The slices themselves belong to the feature that owns
 * the entity type (a capability package names its own port types here), and a host composes them with
 * its own host-only slices by intersection — this contract never imports a feature.
 */

/** What a bag's `Slices` map must look like: `entityType` -> that type's port slice. */
export type PublishPortsSlices = { readonly [entityType: string]: object };

/** The keyed bag: one slice per `entityType` named in `Slices`. */
export type PublishPorts<Slices extends PublishPortsSlices> = { readonly [K in keyof Slices]?: Slices[K] };

/** The `entityType` keys a bag names. */
export type PublishPortsEntityType<Bag extends PublishPortsSlices> = Extract<keyof Bag, string>;

/** One entity type's slice of a bag. */
export type PublishPortsSlice<Bag extends PublishPortsSlices, K extends PublishPortsEntityType<Bag>> = Bag[K];
