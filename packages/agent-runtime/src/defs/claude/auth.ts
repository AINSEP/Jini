import { DEFAULT_HOST_NAME } from '../../auth-common.js';

export function claudeAuthGuidance({  }: {  }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}): string {
  return `Claude Code is installed but is not authenticated. Run \`claude auth login\` or open \`claude\` and complete login in a terminal, then rescan. If ${hostName} was launched outside an interactive shell, your shell rc files (e.g. ~/.zshrc) may not be loaded into its environment.`;
}


// Structured verdict from `claude auth status` JSON: a boolean when either key
// is a boolean (`true` wins), undefined when the text is not JSON or carries
// neither key. An explicit null guard sends JSON `null` to the same
// text-matching fallback as invalid JSON; either true flag still wins.
function claudeJsonAuthFailure({ value }: { value: string }): boolean | undefined {
  let parsed: { authenticated?: unknown; loggedIn?: unknown } | null;
  try {
    parsed = JSON.parse(value) as typeof parsed;
  } catch {
    return undefined; // Fall through to text matching below.
  }
  if (parsed === null) return undefined;
  if (parsed.authenticated === true || parsed.loggedIn === true) return false;
  if (parsed.authenticated === false || parsed.loggedIn === false) return true;
  return undefined;
}

function claudeTextAuthFailure({ value }: { value: string }): boolean {
  if (/"authenticated"\s*:\s*true/i.test(value) || /"loggedIn"\s*:\s*true/i.test(value)) {
    return false;
  }
  return [
    /"authenticated"\s*:\s*false/i,
    /"loggedIn"\s*:\s*false/i,
    /not authenticated/i,
    /not logged[ _-]?in/i,
    /authentication required/i,
    /please (?:sign|log)[ _-]?in/i,
  ].some((pattern) => pattern.test(value));
}

export function isClaudeAuthFailureText({ text }: { text: string }): boolean {
  const value = String(text || '');
  if (!value.trim()) return false;
  return claudeJsonAuthFailure({ value }) ?? claudeTextAuthFailure({ value });
}

export const claudeAuthApiKeyEnv = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const;

export const claudeAuthProfile = {
  isFailure: isClaudeAuthFailureText,
  guidance: ({ hostName }: { hostName: string }) => claudeAuthGuidance({}, { hostName }),
  apiKeyEnv: claudeAuthApiKeyEnv,
};
