/** Separate required inputs from optional settings on every public operation. */
export type OAuthRequiredArgs<T> = Pick<T, {
    [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T]>;
export type OAuthOptionalArgs<T> = Pick<T, {
    [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T]>;
/** Explicit input for operations without values or dependencies. */
export type OAuthEmptyArgs = Readonly<Record<string, never>>;
