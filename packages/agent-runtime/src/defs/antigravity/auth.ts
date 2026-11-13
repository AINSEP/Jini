import { DEFAULT_HOST_NAME } from '../../auth-common.js';

// agy's print mode (`-p`) detects a missing OAuth token, prints the
// Google sign-in URL to stdout, waits 30s for completion, then exits
// "Error: authentication timed out." That URL points at a callback page
// that asks the user to paste the resulting auth code BACK into agy —
// which only works in the interactive TUI. So surfacing the raw URL in a
// chat UI is a dead end (no input field to paste the code into). Instead
// we ask the user to run `agy` in a terminal once, which opens the
// browser, completes OAuth, and writes the credentials to the system
// keyring — both `-p` and TUI invocations read from there afterward, so
// the chat run can succeed on retry.
export function antigravityAuthGuidance({  }: {  }, { hostName = DEFAULT_HOST_NAME }: { hostName?: string } = {}): string {
  return `Antigravity needs to sign in. The agy CLI's keyring entry has expired or been cleared, and \`-p\` print mode cannot complete OAuth on its own (it has no field to paste the auth code into).\n\nFix: open a terminal and run \`agy\` once — it will open Google sign-in in your browser, accept the redirect, and store the token in your system keyring. After you finish, return here and retry this chat. You only need to do this once; the keyring entry persists across both terminal and ${hostName} runs.`;
}

// agy's account-level quota is per-model (consumer accounts get a
// separate quota for Gemini 3 Pro vs Flash vs Claude vs GPT-OSS), and
// when exhausted the upstream returns
//   RESOURCE_EXHAUSTED (code 429): Individual quota reached. Contact
//   your administrator to enable overages. Resets in <H>h<M>m<S>s.
// to the `--log-file`. Print mode emits nothing on stdout/stderr, so
// without log inspection the failure misreads as missing-OAuth.
export function antigravityQuotaGuidance(): string {
  return 'Antigravity returned "RESOURCE_EXHAUSTED: Individual quota reached" for the current model. Each Antigravity model (Gemini 3 Pro / Flash, Claude 4.6, GPT-OSS) has its own quota.\n\nFix: open `agy` in a terminal and use its Switch Model picker (the menu at the bottom of the TUI) to pick a model with available quota, then retry here. Quotas reset automatically on Antigravity\'s schedule.';
}

// agy's plain-mode output when no keyring credentials are available:
//   - Top of stdout: "Authentication required. Please visit the URL to log in: <URL>"
//   - Tail of stdout: "Waiting for authentication (timeout 30s)..."
//                      "Error: authentication timed out."
// The same TUI text is logged by `agy --log-file` as
//   "You are not logged into Antigravity" and
//   "error getting token source: You are not logged into Antigravity"
// Any of these is sufficient signal — match conservatively so the regex
// doesn't fire on prose containing the word "authentication" by accident.
export function isAntigravityAuthFailureText({ text }: { text: string }): boolean {
  const value = String(text || '');
  if (!value.trim()) return false;
  return (
    /authentication required.*please visit/i.test(value) ||
    /authentication timed out/i.test(value) ||
    /not logged into antigravity/i.test(value) ||
    /accounts\.google\.com\/o\/oauth2\/auth.*antigravity/i.test(value)
  );
}


export const antigravityAuthProfile = {
  isFailure: isAntigravityAuthFailureText,
  guidance: ({ hostName }: { hostName: string }) => antigravityAuthGuidance({}, { hostName }),
};
