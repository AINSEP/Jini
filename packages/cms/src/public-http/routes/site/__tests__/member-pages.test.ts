import { expect, it, vi } from "vitest";
import { serveMemberPage, createMemberPages, memberPageRoute } from "../member-pages.js";

it("marks the account private before checking its live session", async () => {
  const calls: string[] = [];
  const deps = { workspaceId: "w", pages: { "/account": { id: "id", title: "Account", body: "account" } }, accountPath: "/account", signInLocation: "/signin#redirect=%2Faccount", markPrivate: () => { calls.push("private"); }, hasLiveSession: async () => { calls.push("session"); return false; } };
  expect(await memberPageRoute.handle({ path: "/account/", deps })).toEqual({ kind: "redirect", status: 303, location: "/signin#redirect=%2Faccount" });
  expect(calls).toEqual(["private", "session"]);
  const fail = vi.fn(async () => { throw new Error("session"); });
  calls.length = 0;
  await expect(memberPageRoute.handle({ path: "/account", deps: { ...deps, hasLiveSession: fail } })).rejects.toThrow("session");
  expect(calls).toEqual(["private"]);
});

it("dispatches missing, signed-out and render failures through their original replies", async () => {
  const calls: unknown[] = [];
  const deps = { workspaceId: "w", pages: { "/account": { id: "id", title: "Account", body: "body" } }, accountPath: "/account", signInLocation: "/signin",
    markPrivate: () => { calls.push("private"); }, hasLiveSession: async () => false };
  const ports = { missing: () => { calls.push(404); }, redirect: (reply: unknown) => { calls.push(reply); }, send: vi.fn(), reportFault: (error: unknown) => { calls.push(error); }, sendFault: () => { calls.push(500); } };
  await serveMemberPage({ path: "/unknown", deps, ...ports });
  await serveMemberPage({ path: "/account", deps, ...ports });
  expect(calls).toEqual([404, "private", { kind: "redirect", status: 303, location: "/signin" }]);
  const error = new Error("render");
  await serveMemberPage({ path: "/account", deps: { ...deps, hasLiveSession: async () => true }, ...ports, send: async () => { throw error; } });
  expect(calls.slice(-2)).toEqual([error, 500]);
});

it("keeps the member script DOM contract and accessibility while binding paths, page IDs and reset copy", () => {
  const pages = createMemberPages({ paths: { signIn: '/login', forgot: '/forgot', reset: '/reset', account: '/profile', reauthenticate: '/login#proof' },
    ids: { signIn: '1', forgot: '2', reset: '3', account: '4' }, copy: { signInTitle: 'Sign in', forgotTitle: 'Reset', resetTitle: 'Choose', accountTitle: 'Account', resetSent: 'Reset lifetime copy', emailLabel: "Email", passwordLabel: "Password", codeLabel: "Code", newPasswordLabel: "New password", currentPasswordLabel: "Current password", signIn: "Sign in", codeInstead: "Email me a code instead", emailCode: "Email me a code", passwordInstead: "Use my password instead", codeTip: "We email you a 6-digit code. New here? Signing in with a code creates your account.", newCode: "Send a new code", finishEmailLink: "Finish signing in from your email link.", continue: "Continue", oidcCodeSent: "We emailed you a 6-digit code to confirm the address is yours. You only need to do this once.", finishSignIn: "Finish signing in", startOver: "Start over", emailResetLink: "Email me a reset link", saveNewPassword: "Save new password", resetIncomplete: "This reset link is incomplete. Ask for a new one.", passwordChanged: "Password changed. Sign in with your new password.", signedOut: "You're signed out.", currentPasswordTip: "Leave this empty if you've only signed in with emailed codes.", savePassword: "Save password", identitiesTip: "Connecting or unlinking an account signs you out on your other devices.", forgotPassword: "Forgot password?", yourAccount: "Your account", signOut: "Sign out", backToSignIn: "Back to sign in", askNewLink: "Ask for a new link", signInWithCode: "Sign in with a code", codeSentPrefix: "We sent a code to ", signedInPrefix: "You're signed in as ", accountSignedInPrefix: "Signed in as ", connectedAccounts: "Connected accounts", orEmail: "or use your email", moreAbout: "More about this", noScript: "Turn on JavaScript to use this page.", showPassword: label => `Show ${label}`, hidePassword: label => `Hide ${label}` } });
  expect(Object.keys(pages)).toEqual(['/login', '/forgot', '/reset', '/profile']);
  expect(pages['/login']).toMatchObject({ id: '1', title: 'Sign in' });
  expect(pages['/login']?.body).toContain('data-member-view="oidc-code" hidden');
  expect(pages['/login']?.body).toContain('aria-controls="member-signin-password"');
  expect(pages['/login']?.body).toContain('role="alert" hidden');
  expect(pages['/forgot']?.body).toContain('Reset lifetime copy');
  expect(pages['/profile']?.body).toContain('href="/login#proof"');
  expect(pages['/profile']?.body).toContain('data-member-identity-list');
});
