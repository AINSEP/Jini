export interface SmtpTransport {
  // Keep the vendor behind a structural seam so delivery rules can run without a real SMTP socket.
  sendMail(required: { mail: SmtpMailPayload }): Promise<{ messageId: string }>;
}

export interface SmtpMailPayload {
  from: { name?: string; address: string };
  to: { name?: string; address: string };
  replyTo?: { name?: string; address: string };
  subject: string;
  html?: string;
  text?: string;
  headers?: Readonly<Record<string, string>>;

  // The vendor expects a mutable attachment array; send constructs a fresh one, so no caller-owned
  // array is exposed to mutation. A local payload type also keeps fakes independent of vendor types.
  attachments?: { filename: string; content: string; encoding: "base64"; contentType: string }[];
}
