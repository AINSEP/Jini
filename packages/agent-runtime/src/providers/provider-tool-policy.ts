/** Request adapters choose strict support for their actual endpoint/model; policy is always prefer. */
export interface ProviderToolSnapshotOptions { readonly strict?: boolean }
export interface ProviderSchemaFallback {
  readonly toolId: string;
  readonly protocol: ProviderProtocol;
  readonly reason: OperationSchemaFallbackReason;
}
export type ProviderProtocol = "anthropic" | "openai" | "azure" | "google";

/** Closed reason codes are safe to observe: no schema, argument values or provider error text. */
export type OperationSchemaFallbackReason = 'endpoint-unsupported' | 'endpoint-rejected' | 'open-map' | 'recursive-schema' | 'unresolved-reference' | 'unsupported-schema' | 'optional-nullable' | 'schema-limit';
