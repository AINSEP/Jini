import type { PublicPostRecord } from '../../../posts/post.js';

export type MemberPageReply = { kind: 'missing' } | { kind: 'redirect'; status: 303; location: string } | { kind: 'page'; post: PublicPostRecord };

/** The in-memory Page {@link serveVirtualPage} renders for one member path. @complexity O(1). */
export function makeMemberPagePost({ path, workspaceId, pages }: {
  path: string; workspaceId: string; pages: Readonly<Partial<Record<string, { id: string; title: string; body: string }>>>;
}, _optional = {}): PublicPostRecord | undefined {
  const entry = Object.hasOwn(pages, path) ? pages[path] : undefined;
  if (!entry) return undefined;
  return {
    id: entry.id, workspaceId, title: entry.title, slug: path.slice(1),
    bodyJson: {}, status: 'published', kind: 'page', bodyFormat: 'html', bodyHtml: entry.body,
    updatedAt: new Date(0).toISOString(), version: 1, templateChoice: null,
  };
}

export const memberPageRoute = {
  method: 'get' as const,
  async handle({ path, deps }: {
    path: string;
    deps: {
      workspaceId: string; pages: Readonly<Partial<Record<string, { id: string; title: string; body: string }>>>;
      accountPath: string; signInLocation: string;
      markPrivate(required: Record<string, never>): void;
      hasLiveSession(required: Record<string, never>): Promise<boolean>;
    };
  }, _optional = {}): Promise<MemberPageReply> {
    const normalized = path.replace(/\/$/, '');
    const post = makeMemberPagePost({ path: normalized, workspaceId: deps.workspaceId, pages: deps.pages });
    if (!post) return { kind: 'missing' };
    if (normalized === deps.accountPath) {
      // The response depends on a cookie: never share either the page or redirect through a cache.
      deps.markPrivate({});
      const session = await deps.hasLiveSession({});
      if (!session) {
        // Use sign-in's validated fragment contract; a fixed local path cannot inherit an attacker return URL.
        return { kind: 'redirect', status: 303, location: deps.signInLocation };
      }
    }
    return { kind: 'page', post };
  },
};

/** One labelled input. `tip` adds an ⓘ button beside the label that opens `tip.text` on tap. */
function field(input: { id: string; label: string; name: string; type: string; autocomplete: string; extra?: string;
  tip?: string; copy: Parameters<typeof createMemberPages>[0]["copy"] }): string {
  const tipId = `${input.id}-tip`;
  const label = `<label for="${input.id}">${input.label}</label>`;
  const head = input.tip ? `<span class="member-label-row">${label}${tipButton({ id: tipId, label: input.copy.moreAbout })}</span>${tipText({ id: tipId, text: input.tip })}` : label;
  const control = `<input id="${input.id}" name="${input.name}" type="${input.type}" ` +
    `autocomplete="${input.autocomplete}"${input.type === "password" ? ' spellcheck="false"' : ""}${input.extra ?? ""}>`;
  const body = input.type === "password" ? `<span class="member-password">${control}${passwordToggle({ id: input.id, show: input.copy.showPassword(input.label), hide: input.copy.hidePassword(input.label) })}</span>` : control;
  return `<div class="field member-field">${head}${body}</div>`;
}

/** Public-page counterpart of SecretInput: the changing name carries state, outside the label.
 * The member script toggles the native input; no secret is serialized into this markup.
 * @complexity O(n) in the rendered id and label lengths. */
function passwordToggle({ id, show, hide }: { id: string; show: string; hide: string }, _optional = {}): string {
  return `<button type="button" class="member-password-toggle" aria-controls="${id}" aria-label="${show}" ` +
    `data-member-password-toggle data-show-label="${show}" data-hide-label="${hide}">` +
    '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' +
    '<path class="member-password-slash" d="M2 2l20 20" hidden/></svg></button>';
}

function tipButton({ id, label }: { id: string; label: string }, _optional = {}): string {
  return `<button type="button" class="member-tip" aria-label="${label}" aria-expanded="false" aria-controls="${id}">i</button>`;
}

function tipText({ id, text }: { id: string; text: string }, _optional = {}): string {
  return `<span class="member-tip-text" id="${id}" hidden>${text}</span>`;
}

const messages = '<p class="member-note" data-member-error role="alert" hidden></p><p class="member-note" data-member-ok role="status" hidden></p>';

function form({ name, inner, submit }: { name: string; inner: string; submit: string }, { after = "" }: { after?: string } = {}): string {
  return `<form data-member-form="${name}">${inner}${messages}<div class="member-actions">` +
    `<button type="submit" class="btn btn-solid member-submit">${submit}</button>${after}</div></form>`;
}

function view({ name, inner }: { name: string; inner: string }, _optional = {}): string {
  return `<section data-member-view="${name}" hidden>${inner}</section>`;
}

function links({ items }: { items: string[] }, _optional = {}): string {
  return `<p class="member-auth-links">${items.join("")}</p>`;
}

function showButton({ target, label }: { target: string; label: string }, _optional = {}): string {
  return `<button type="button" class="member-link" data-member-show="${target}">${label}</button>`;
}

/** A status line a view opens on; `tabindex` lets the script move focus to it so it is read out. */
function note({ html }: { html: string }, _optional = {}): string {
  return `<p class="member-note" tabindex="-1" data-member-focus>${html}</p>`;
}

/** A start/callback refusal lands on /signin#oidcError=<CODE>; the script says it in words here. */
const OIDC_ERROR = '<p class="member-note member-oidc-error" data-member-oidc-error role="alert" tabindex="-1" hidden></p>';

/** Page templates print the body only (an authored Page brings its own heading), so the h1 is here. */
function page({ kind, title, views, noScript }: { kind: string; title: string; views: string[]; noScript: string }, { top = "" }: { top?: string } = {}): { title: string; body: string } {
  return { title, body: `<div class="member-auth" data-member-page="${kind}"><h1>${title}</h1><noscript><p>${noScript}</p></noscript>` +
    `${top}${views.join("")}</div>` };
}

const CODE_REQUEST_VIEW = "code-request";
const EMAIL = ({ id, copy }: { id: string; copy: Parameters<typeof createMemberPages>[0]["copy"] }, _optional = {}) => field({ copy, id, label: copy.emailLabel, name: "email", type: "email", autocomplete: "email", extra: " required" });

function SIGN_IN(required: Parameters<typeof createMemberPages>[0], _optional = {}) {
/** Provider buttons (filled by the script) above the email forms, with an "or" rule under them. */
const PROVIDERS = '<div class="member-providers" data-member-providers hidden><div class="member-provider-list" data-member-provider-list></div>' +
  `<p class="member-or"><span>${required.copy.orEmail}</span></p></div>`;
  return page({ noScript: required.copy.noScript, kind: "signin", title: required.copy.signInTitle, views: [
  view({ name: "password", inner: form({ name: "password", inner: EMAIL({ copy: required.copy, id: "member-signin-email" }) +
      field({ copy: required.copy, id: "member-signin-password", label: required.copy.passwordLabel, name: "password", type: "password", autocomplete: "current-password", extra: " required" }), submit: required.copy.signIn }) +
    links({ items: [`<a href="${required.paths.forgot}">${required.copy.forgotPassword}</a>`, showButton({ target: CODE_REQUEST_VIEW, label: required.copy.codeInstead })] }) }),
  view({ name: CODE_REQUEST_VIEW, inner: form({ name: CODE_REQUEST_VIEW, inner: EMAIL({ copy: required.copy, id: "member-code-email" }), submit: required.copy.emailCode }, { after: tipButton({ id: "member-code-tip", label: required.copy.moreAbout }) + tipText({ id: "member-code-tip", text: required.copy.codeTip }) }) +
    links({ items: [showButton({ target: "password", label: required.copy.passwordInstead })] }) }),
  view({ name: "code", inner: note({ html: `${required.copy.codeSentPrefix}<strong data-member-email></strong>.` }) +
    form({ name: "code", inner: field({ copy: required.copy, id: "member-code", label: required.copy.codeLabel, name: "code", type: "text", autocomplete: "one-time-code",
      extra: ' inputmode="numeric" maxlength="7" required' }), submit: required.copy.signIn }) +
    links({ items: [showButton({ target: CODE_REQUEST_VIEW, label: required.copy.newCode })] }) }),
  view({ name: "magic", inner: form({ name: "magic", inner: note({ html: required.copy.finishEmailLink }), submit: required.copy.continue }) +
    links({ items: [showButton({ target: CODE_REQUEST_VIEW, label: required.copy.newCode })] }) }),
  view({ name: "signed-in", inner: note({ html: `${required.copy.signedInPrefix}<strong data-member-email></strong>.` }) +
    links({ items: [`<a href="${required.paths.account}">${required.copy.yourAccount}</a>`, `<button type="button" class="member-link" data-member-sign-out>${required.copy.signOut}</button>`] }) }),
  // A provider account whose address isn't the provider's own (not Gmail/Workspace): one emailed
  // code proves the inbox the first time. The sealed continuation arrives in the fragment.
  view({ name: "oidc-code", inner: note({ html: required.copy.oidcCodeSent }) +
    form({ name: "oidc-code", inner: field({ copy: required.copy, id: "member-oidc-code", label: required.copy.codeLabel, name: "code", type: "text", autocomplete: "one-time-code",
      extra: ' inputmode="numeric" maxlength="7" required' }), submit: required.copy.finishSignIn }) +
    links({ items: [showButton({ target: "password", label: required.copy.startOver })] }) }),
] }, { top: OIDC_ERROR + PROVIDERS });
}

function FORGOT(required: Parameters<typeof createMemberPages>[0], _optional = {}) { return page({ noScript: required.copy.noScript, kind: "forgot", title: required.copy.forgotTitle, views: [
  view({ name: "forgot", inner: form({ name: "forgot", inner: EMAIL({ copy: required.copy, id: "member-forgot-email" }), submit: required.copy.emailResetLink }) + links({ items: [`<a href="${required.paths.signIn}">${required.copy.backToSignIn}</a>`] }) }),
  view({ name: "sent", inner: note({ html: required.copy.resetSent }) +
    links({ items: [`<a href="${required.paths.signIn}">${required.copy.backToSignIn}</a>`] }) }),
] });
}

function RESET(required: Parameters<typeof createMemberPages>[0], _optional = {}) { return page({ noScript: required.copy.noScript, kind: "reset", title: required.copy.resetTitle, views: [
  view({ name: "reset", inner: form({ name: "reset", inner: field({ copy: required.copy, id: "member-reset-password", label: required.copy.newPasswordLabel, name: "password", type: "password",
    autocomplete: "new-password", extra: " required" }), submit: required.copy.saveNewPassword }) + links({ items: [`<a href="${required.paths.forgot}">${required.copy.askNewLink}</a>`] }) }),
  view({ name: "missing", inner: note({ html: required.copy.resetIncomplete }) + links({ items: [`<a href="${required.paths.forgot}">${required.copy.askNewLink}</a>`] }) }),
  view({ name: "done", inner: note({ html: required.copy.passwordChanged }) + links({ items: [`<a href="${required.paths.signIn}">${required.copy.signIn}</a>`] }) }),
] });
}

function ACCOUNT(required: Parameters<typeof createMemberPages>[0], _optional = {}) {
const signOutButton = `<button type="button" class="btn btn-ghost" data-member-sign-out>${required.copy.signOut}</button>`;
const REAUTH = `<p class="member-note" data-member-reauth hidden><a href="${required.paths.reauthenticate}">${required.copy.signInWithCode}</a></p>`;

/** Connected login providers: "<Label> connected · Unlink" or "Connect <Label>" rows, script-filled. */
const IDENTITIES = '<div class="member-identities" data-member-identities hidden><div class="member-label-row member-heading-row">' +
  `<h2>${required.copy.connectedAccounts}</h2>${tipButton({ id: "member-identities-tip", label: required.copy.moreAbout })}</div>` +
  tipText({ id: "member-identities-tip", text: required.copy.identitiesTip }) +
  `<ul class="member-identity-list" data-member-identity-list></ul>${messages}${REAUTH}</div>`;

  return page({ noScript: required.copy.noScript, kind: "account", title: required.copy.accountTitle, views: [
  view({ name: "signed-out", inner: note({ html: required.copy.signedOut }) + links({ items: [`<a href="${required.paths.signIn}">${required.copy.signIn}</a>`] }) }),
  view({ name: "account", inner: note({ html: `${required.copy.accountSignedInPrefix}<strong data-member-email></strong>.` }) + `<h2>${required.copy.passwordLabel}</h2>` +
    form({ name: "set", inner: field({ copy: required.copy, id: "member-current-password", label: required.copy.currentPasswordLabel, name: "currentPassword", type: "password",
        autocomplete: "current-password", tip: required.copy.currentPasswordTip }) +
        field({ copy: required.copy, id: "member-new-password", label: required.copy.newPasswordLabel, name: "password", type: "password", autocomplete: "new-password", extra: " required" }), submit: required.copy.savePassword }) +
    REAUTH + IDENTITIES + `<div class="member-actions member-signout">${signOutButton}</div>` }),
] });
}

export function createMemberPages(required: {
  paths: { signIn: string; forgot: string; reset: string; account: string; reauthenticate: string };
  ids: { signIn: string; forgot: string; reset: string; account: string };
  copy: { signInTitle: string; forgotTitle: string; resetTitle: string; accountTitle: string; resetSent: string;
    accountSignedInPrefix: string; askNewLink: string; backToSignIn: string; codeInstead: string;
    codeLabel: string; codeSentPrefix: string; codeTip: string; connectedAccounts: string;
    continue: string; currentPasswordLabel: string; currentPasswordTip: string; emailCode: string;
    emailLabel: string; emailResetLink: string; finishEmailLink: string; finishSignIn: string;
    forgotPassword: string; identitiesTip: string; moreAbout: string; newCode: string;
    newPasswordLabel: string; noScript: string; oidcCodeSent: string; orEmail: string;
    passwordChanged: string; passwordInstead: string; passwordLabel: string; resetIncomplete: string;
    saveNewPassword: string; savePassword: string; signIn: string; signInWithCode: string;
    signOut: string; signedInPrefix: string; signedOut: string; startOver: string;
    yourAccount: string;
    showPassword: (label: string) => string; hidePassword: (label: string) => string;
  };
}, _optional = {}) {
  return {
    [required.paths.signIn]: { id: required.ids.signIn, ...SIGN_IN(required) },
    [required.paths.forgot]: { id: required.ids.forgot, ...FORGOT(required) },
    [required.paths.reset]: { id: required.ids.reset, ...RESET(required) },
    [required.paths.account]: { id: required.ids.account, ...ACCOUNT(required) },
  };
}

export async function serveMemberPage(required: {
  path: string; deps: Parameters<typeof memberPageRoute.handle>[0]['deps'];
  missing: () => void; redirect: (reply: Extract<MemberPageReply, { kind: 'redirect' }>) => void;
  send: (post: PublicPostRecord) => Promise<void>; reportFault: (error: unknown) => void; sendFault: () => void;
}, _optional = {}): Promise<void> {
  try {
    const reply = await memberPageRoute.handle({ path: required.path, deps: required.deps });
    if (reply.kind === 'missing') { required.missing(); return; }
    if (reply.kind === 'redirect') { required.redirect(reply); return; }
    await required.send(reply.post);
  } catch (error) { required.reportFault(error); required.sendFault(); }
}
