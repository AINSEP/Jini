/** An object that builds its real instance on first property read (or `in` test) and binds methods to it. Used e.g. for an in-memory `:memory:` database, so a root that never touches it never opens one. */
export function createLazyProxy<T extends object>({ factory }: { factory: () => T }, _optional = {}): T {
  let instance: T | undefined;
  return new Proxy({} as T, {
    get(_target, property) {
      const object = (instance ??= factory());
      const value = Reflect.get(object, property, object);
      return typeof value === "function" ? value.bind(object) : value;
    },
    // `in` must see the real instance too: `sqliteKernel` tells a Drizzle handle from its client by `"$client" in`.
    has(_target, property) {
      instance ??= factory();
      return Reflect.has(instance, property);
    },
  });
}
