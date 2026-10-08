/** JSON wire values. Kept local so the foundational protocol never imports a kernel package. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
