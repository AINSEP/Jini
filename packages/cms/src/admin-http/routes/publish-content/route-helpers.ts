/** The status-and-body pair a refusal or a mapped error answers with. */
export interface RouteRefusal {
  status: number;
  body: Record<string, unknown>;
}

/** A typed store/transport error class and the status/code it answers with. */
export type MappedErrorClass = readonly [errorClass: abstract new (...args: never[]) => Error, status: number, code: string];

export function knownMappedErrorResponse({ err, table }: { err: unknown; table: readonly MappedErrorClass[] }, _optional = {}): RouteRefusal | undefined {
  for (const [errorClass, status, code] of table) {
    if (err instanceof errorClass) return { status, body: { error: err.message, code } };
  }
  return undefined;
}

/**
 * Maps a typed error to its status and `{error, code}` body, keeping the typed error's own message.
 * Anything not in `table` is a 500 with fixed text: a raw driver error's message is never echoed.
 * @complexity O(t) in the table length.
 */
export function mappedErrorResponse({ err, table, incident, operation, method, route, discloseDetails }: {
  err: unknown; table: readonly MappedErrorClass[];
  incident: (error: unknown, options: { operation: string; method?: string | undefined; route?: string | undefined; discloseDetails?: boolean | undefined; message?: string | undefined }) => RouteRefusal;
  operation: string; method?: string | undefined; route?: string | undefined; discloseDetails?: boolean | undefined;
}, { message }: { message?: string } = {}): RouteRefusal {
  const known = knownMappedErrorResponse({ err, table });
  if (known) return known;
  return incident(err, { operation, message, method, route, discloseDetails });
}

export function createMappedErrorResponse(required: Pick<Parameters<typeof mappedErrorResponse>[0], 'incident' | 'operation'>, _optional = {}) {
  return (input: Omit<Parameters<typeof mappedErrorResponse>[0], 'incident' | 'operation'>, optional: Parameters<typeof mappedErrorResponse>[1] = {}): RouteRefusal => mappedErrorResponse({ ...input, ...required }, optional);
}
