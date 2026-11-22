import { DEFAULT_HOST_NAME } from '../../auth-common.js';

export function reasonixAuthGuidance({  }: {  }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}): string {
  return `DeepSeek Reasonix is installed but is not authenticated. Add your API key in \`~/.reasonix/config.json\` under \`apiKey\`, or expose DEEPSEEK_API_KEY to ${hostName}'s daemon process, then retry. If ${hostName} is launched outside an interactive shell, shell rc files such as ~/.zshrc may not be loaded.`;
}

export function isReasonixAuthFailureText({ text }: { text: string }): boolean {
  const value = String(text || '');
  if (!value.trim()) return false;
  return (
    (/~\/\.reasonix\/config\.json/i.test(value) &&
      /api[_ -]?key|missing|not set|required|unauthorized|invalid/i.test(value)) ||
    (/DEEPSEEK_API_KEY/i.test(value) &&
      /auth|missing|not set|required|unauthorized|invalid/i.test(value))
  );
}


export const reasonixAuthProfile = {
  isFailure: isReasonixAuthFailureText,
  guidance: ({ hostName }: { hostName: string }) => reasonixAuthGuidance({}, { hostName }),
};
