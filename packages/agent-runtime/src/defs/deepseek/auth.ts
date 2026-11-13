import { DEFAULT_HOST_NAME } from '../../auth-common.js';

export function deepseekAuthGuidance({  }: {  }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}): string {
  return `DeepSeek TUI is installed but is not authenticated. Add or verify your API key in \`~/.deepseek/config.toml\` as \`api_key = "..."\`, or expose DEEPSEEK_API_KEY to ${hostName}'s daemon process, then retry. If ${hostName} is launched outside an interactive shell, shell rc files such as ~/.zshrc may not be loaded.`;
}

export function isDeepSeekAuthFailureText({ text }: { text: string }): boolean {
  const value = String(text || '');
  if (!value.trim()) return false;
  const placeholderKey = /KEY=<your-key>/i.test(value) || /api_key\s*=\s*["']<your-key>["']/i.test(value);
  const configMentionsKey = /~\/\.deepseek\/config\.toml/i.test(value) && /api[_ -]?key|KEY=/i.test(value);
  const envKeyProblem = /DEEPSEEK_API_KEY/i.test(value) && /auth|missing|not set|required|unauthorized|empty|invalid/i.test(value);
  return placeholderKey || configMentionsKey || envKeyProblem;
}


export const deepseekAuthProfile = {
  isFailure: isDeepSeekAuthFailureText,
  guidance: ({ hostName }: { hostName: string }) => deepseekAuthGuidance({}, { hostName }),
};
