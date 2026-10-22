/** Shared marker error for the Tauri adapter's explicitly-out-of-scope port methods (RenderService, ProtocolHandlerPort — see each file's header comment for why). */
export class NotImplementedError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = 'NotImplementedError';
  }
}
