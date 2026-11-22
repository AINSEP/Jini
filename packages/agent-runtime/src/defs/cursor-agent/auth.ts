import { DEFAULT_HOST_NAME } from '../../auth-common.js';

export function cursorAuthGuidance({  }: {  }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}): string {
  return `Cursor Agent is not authenticated. Run \`cursor-agent login\`, then \`cursor-agent status\`, and retry. For automation, ensure CURSOR_API_KEY is set in ${hostName}'s process environment.`;
}

export function isCursorAuthFailureText({ text }: { text: string }): boolean {
  const value = String(text || '');
  if (!value.trim()) return false;
  return [
    /authentication required/i,
    /not authenticated/i,
    /not logged in/i,
    /unauthenticated/i,
    /agent login/i,
    /cursor_api_key/i,
  ].some((pattern) => pattern.test(value));
}


export const cursorAuthProfile = {
  isFailure: isCursorAuthFailureText,
  guidance: ({ hostName }: { hostName: string }) => cursorAuthGuidance({}, { hostName }),
};
