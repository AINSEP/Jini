/**
 * @file The page-capability runtime port: chat only forwards page-control requests, it never calls driver
 * methods. The host binds the implementation (a DOM driver, a native shell, a test fake) once.
 */
export interface ChatPagePort {
  /** Ids of the page capabilities the host can execute. */
  readonly capabilityIds: readonly string[];
  execute(
    required: { capabilityId: string; input: Record<string, unknown> },
    optional?: { signal?: AbortSignal },
  ): Promise<unknown>;
}
