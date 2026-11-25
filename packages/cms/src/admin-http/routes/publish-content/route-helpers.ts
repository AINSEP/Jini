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
