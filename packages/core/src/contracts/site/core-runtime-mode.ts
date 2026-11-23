/**
 * The host's runtime-mode policy signal. The host reads it from its own dedicated setting and never
 * from `NODE_ENV`; any missing or unrecognized value resolves to `local`, never `production`: the
 * only default that is safe in both directions, since it activates no containment the operator
 * didn't explicitly opt into. Dependency-free so mail and assistant consumers need no host server
 * transport module to name it.
 */
export type RuntimeMode = "production" | "local";
