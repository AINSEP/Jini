/** Transport port. The default adapter translates SDK callbacks to object arguments. */
export interface McpTransportLike {
  onmessage?: ((args: { message: unknown }) => void) | undefined;
  onclose?: (() => void) | undefined;
  close(required: Record<string, never>): Promise<void>;
}

