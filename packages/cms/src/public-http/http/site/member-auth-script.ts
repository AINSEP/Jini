/**
 * @file The one inline script + style behind member sign-in on public pages: the theme's header
 * "Sign in" link (any element carrying `data-member-nav`) and core's `/signin`, `/forgot-password`,
 * `/reset-password` and `/account` pages (`routes/site/member-pages.ts`, `data-member-page`).
 *
 * The theme owns the header markup; this only enhances it. Signed out, the link stays a plain
 * `<a href="/signin">` that works with JS off. Signed in (`GET …/me`), it becomes the member's email
 * (to `/account`) plus a "Sign out" button carrying the link's own classes, so the theme's button
 * look applies (on phones the link reads "Account" and Sign out moves to /account). Without JS the
 * forms stay `hidden`: the member API reads JSON bodies only (a plain same-origin form post gets a
 * 400, a cross-site one a 403), and a GET-submitted form would put the password in the URL.
 *
 * Contract: `SHARD-E-CONTRACT.md` (2026-10-24). Tokens from the emailed links arrive in the URL
 * fragment; the script strips the fragment with `history.replaceState` BEFORE anything else and
 * never posts a token until the visitor presses Continue. Login providers (Google login U1) follow
 * the same rule: the sealed `continuation` of the emailed-code step arrives in the fragment and is
 * stripped first; a start/callback refusal arrives as `#oidcError=<CODE>` and is shown in words. Redirect targets are re-checked here with
 * the contract's same-origin rule even though the server checks them too.
 *
 * `String.raw` keeps the regex backslashes literal; the only template placeholders are the host's
 * {@link MemberAuthNames} interpolations, and the generated script must never contain a backtick or a
 * closing script tag (hosts pass plain class names).
 */

/** The host-owned class names the member sign-in style and script select on and emit. The engine
 *  ships no legacy product class name, so a host passes the ones its themes and member page markup
 *  already carry (every value is interpolated verbatim, so the generated CSS/JS carries exactly what
 *  the host supplies). The `data-member-*` hooks are the engine's own contract with the markup and
 *  are not part of this. */
export interface MemberAuthNames {
  /** Root class of a member page (scopes every rule below it). */
  readonly authClass: string;
  /** A labelled input row. */
  readonly fieldClass: string;
  /** A password input's wrapper (positions the reveal toggle). */
  readonly passwordClass: string;
  /** The reveal toggle button inside {@link passwordClass}. */
  readonly passwordToggleClass: string;
  /** The "hidden password" slash glyph inside the toggle's icon (the script flips its `hidden`). */
  readonly passwordSlashClass: string;
  /** Row holding a label beside its tip. */
  readonly labelRowClass: string;
  /** Row of form action buttons. */
  readonly actionsClass: string;
  /** The primary submit button. */
  readonly submitClass: string;
  /** Row of secondary links under a form. */
  readonly linksClass: string;
  /** A link-styled control (also stamped on the unlink button the script builds). */
  readonly linkClass: string;
  /** A status/explanatory note. */
  readonly noteClass: string;
  /** The sign-out section of the account page. */
  readonly signoutClass: string;
  /** List wrapper of login-provider buttons. */
  readonly providerListClass: string;
  /** A login-provider button (the script builds these). */
  readonly providerClass: string;
  /** Space-separated theme classes the script adds before {@link providerClass} on a provider link (the theme's button look). */
  readonly providerThemeClasses: string;
  /** The "or use your email" divider. */
  readonly orClass: string;
  /** The login-provider refusal message. */
  readonly oidcErrorClass: string;
  /** Heading row sharing a line with its tip. */
  readonly headingRowClass: string;
  /** The connected-identities section. */
  readonly identitiesClass: string;
  /** List of connected identities. */
  readonly identityListClass: string;
  /** One connected-identity row (the script builds these). */
  readonly identityClass: string;
  /** The round tip toggle (the script wires every element carrying it). */
  readonly tipClass: string;
  /** The tip's revealed text. */
  readonly tipTextClass: string;
  /** Short ("Account") label span the script builds in the header link. */
  readonly accountShortClass: string;
  /** Email label span the script builds in the header link. */
  readonly accountEmailClass: string;
  /** Private custom property holding the mode-aware `--danger` fallback colour. */
  readonly dangerFallbackProp: string;
  /** Private custom property holding the mode-aware `--success` fallback colour. */
  readonly successFallbackProp: string;
}

type NamesArgs = { names: MemberAuthNames };
type NoOptions = Record<string, never>;

/** Zero-specificity fallback look, tokens only (the set every theme defines, see
 *  `formBaselineStyle`), so a theme's own `.field`/`.btn` rules always win. */
export function memberAuthStyle({ names: n }: NamesArgs, _optional: NoOptions = {}): string {
  return (
    ":where([data-member-view][hidden],[data-member-reauth][hidden]){display:none!important;}" +
    `:where(.${n.authClass}){max-width:30rem;}` +
    `:where(.${n.authClass} form){display:flex;flex-direction:column;}` +
    `:where(.${n.fieldClass}){display:flex;flex-direction:column;gap:6px;margin:0 0 16px;}` +
    `:where(.${n.fieldClass} label){font-weight:600;font-size:0.9rem;}` +
    `:where(.${n.fieldClass} input){font:inherit;padding:8px 10px;border:1px solid var(--border,#d1d5db);border-radius:6px;background:var(--bg,#fff);color:inherit;max-width:100%;box-sizing:border-box;}` +
    `:where(.${n.passwordClass}){position:relative;display:flex;}` +
    `.${n.passwordClass} input{width:100%;padding-inline-end:44px;}` +
    `:where(.${n.passwordToggleClass}){position:absolute;inset-inline-end:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;width:44px;border:0;background:transparent;color:inherit;cursor:pointer;}` +
    `.${n.passwordToggleClass} svg [hidden]{display:none;}` +
    `.${n.passwordToggleClass}:focus-visible{outline:2px solid currentColor;outline-offset:-4px;border-radius:6px;}` +
    `:where(.${n.labelRowClass}){display:flex;align-items:center;gap:8px;}` +
    `:where(.${n.actionsClass}){display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:4px;}` +
    `:where(.${n.authClass} .${n.submitClass}){padding:8px 16px;border:1px solid transparent;border-radius:6px;background:var(--fg,#111827);color:var(--bg,#fff);font:inherit;font-weight:600;cursor:pointer;}` +
    // Scoped: a theme `.btn{opacity:1}` would otherwise hide the in-flight state.
    `.${n.authClass} button:disabled{opacity:0.6;cursor:progress;}` +
    `:where(.${n.linksClass}){display:flex;flex-wrap:wrap;gap:8px 20px;font-size:0.9rem;}` +
    `:where(.${n.linkClass}){background:none;border:0;padding:0;font:inherit;cursor:pointer;}` +
    // Links and link-buttons in one row must look alike, so this one rule is not :where() — it has to
    // beat a theme's bare `a` reset. Same underline-by-border look as the themes' own `.auth-foot a`.
    // The "Sign in with a code" re-auth link too: inside a muted note it read as plain grey text.
    `.${n.linksClass} :is(a,.${n.linkClass}),.${n.authClass} [data-member-reauth] a{color:var(--fg,inherit);text-decoration:none;border-bottom:1px solid var(--border-strong,currentColor);}` +
    // Vertical rhythm is not :where() either: themes zero `h1`/`p` margins
    // (a starter theme's bare `p{margin:0}`), which left the heading and the links row touching the form.
    `.${n.authClass} h1{margin:0 0 28px;}` +
    `.${n.authClass} h2{margin:32px 0 16px;font-size:1.15rem;}` +
    `.${n.authClass} .${n.linksClass}{margin:24px 0 0;}` +
    `.${n.authClass} .${n.noteClass}{margin:0 0 20px;}` +
    `.${n.authClass} form .${n.noteClass}{margin:0 0 16px;}` +
    // The script focuses a view's status note (tabindex=-1) so it is read out; it is not a control, so
    // no focus ring (the theme drew one around plain text after "Email me a code").
    `.${n.authClass} [data-member-focus]:focus{outline:none;}` +
    // Sign out is its own section on /account, not a second button of the password form.
    `.${n.authClass} .${n.signoutClass}{margin:32px 0 0;padding-top:24px;border-top:1px solid var(--border,#d1d5db);}` +
    // A 6-digit code needs a short box, not the full form width.
    `:where(.${n.authClass} input[autocomplete="one-time-code"]){max-width:12rem;letter-spacing:0.15em;font-variant-numeric:tabular-nums;}` +
    // Login providers: content-width buttons, then a quiet "or use your email" rule before the form.
    ":where([data-member-providers][hidden],[data-member-identities][hidden],[data-member-oidc-error][hidden]){display:none!important;}" +
    `:where(.${n.providerListClass}){display:flex;flex-direction:column;align-items:flex-start;gap:10px;}` +
    `:where(.${n.authClass} .${n.providerClass}){display:inline-flex;align-items:center;padding:8px 16px;border:1px solid var(--border-strong,#9ca3af);border-radius:6px;background:transparent;color:inherit;font:inherit;font-weight:600;text-decoration:none;}` +
    `.${n.authClass} .${n.orClass}{display:flex;align-items:center;gap:12px;margin:24px 0;color:var(--muted,#6b7280);font-size:0.85rem;}` +
    `.${n.authClass} .${n.orClass}::after{content:"";flex:1;border-top:1px solid var(--border,#d1d5db);}` +
    `.${n.authClass} .${n.oidcErrorClass}{color:var(--danger,var(${n.dangerFallbackProp}));font-weight:600;font-size:0.9rem;}` +
    // /account: "<Label> connected · Unlink" rows. The heading shares a row with its ⓘ tip.
    `.${n.authClass} .${n.headingRowClass}{margin:32px 0 16px;}` +
    `.${n.authClass} .${n.headingRowClass} h2{margin:0;}` +
    `.${n.authClass} .${n.identitiesClass} .${n.tipTextClass}{margin:-6px 0 16px;}` +
    `.${n.authClass} .${n.identityListClass}{list-style:none;margin:0 0 16px;padding:0;display:flex;flex-direction:column;align-items:flex-start;gap:12px;}` +
    `:where(.${n.identityClass}){display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 16px;}` +
    `.${n.identityClass} .${n.linkClass}{color:var(--fg,inherit);border-bottom:1px solid var(--border-strong,currentColor);font-size:0.9rem;}` +
    `:where(.${n.tipClass}){display:inline-flex;align-items:center;justify-content:center;width:1.4rem;height:1.4rem;padding:0;border:1px solid var(--border-strong,#9ca3af);border-radius:50%;background:transparent;color:var(--muted,#6b7280);font:inherit;font-size:0.8rem;line-height:1;cursor:pointer;}` +
    `:where(.${n.tipTextClass}:not([hidden])){display:block;flex-basis:100%;padding:8px 10px;border-radius:6px;background:var(--surface-2,#f3f4f6);border:1px solid var(--border,#d1d5db);color:var(--fg,#111827);font-size:0.85rem;font-weight:400;}` +
    ":where([data-member-account]){display:inline-block;max-width:14rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;font-size:0.875rem;color:var(--muted,#6b7280);}" +
    // Phones: the email plus a Sign out button pushed the theme's menu button off a 375px header, so
    // the link reads "Account" there and Sign out lives on /account.
    `:where(.${n.accountShortClass}){display:none;}` +
    `@media (max-width:600px){[data-member-account] .${n.accountEmailClass}{display:none;}` +
    `[data-member-account] .${n.accountShortClass}{display:inline;}button[data-member-nav-sign-out]{display:none;}}` +
    // Mode-aware fallbacks for themes with no --danger/--success, same values and contrast reasoning
    // as FORM_BASELINE_STYLE's private pair. Scoped, not :where(): a theme's bare `p{color:…}` would
    // otherwise turn errors grey.
    `:root{${n.dangerFallbackProp}:#f87171;${n.successFallbackProp}:#4ade80;}` +
    `:root[data-theme="light"]{${n.dangerFallbackProp}:#b91c1c;${n.successFallbackProp}:#166534;}` +
    `.${n.authClass} [data-member-error]{color:var(--danger,var(${n.dangerFallbackProp}));font-weight:600;font-size:0.9rem;}` +
    `.${n.authClass} [data-member-ok]{color:var(--success,var(${n.successFallbackProp}));font-weight:600;font-size:0.9rem;}`);
}

/**
 * The browser half before the host names are baked in: each `@@name@@` token is a {@link MemberAuthNames} field.
 * Kept as data (not a function body) so the script text is one template the namer fills.
 */
const MEMBER_AUTH_SCRIPT_TEMPLATE = String.raw`(function (base) {
  "use strict";
  var doc = document;
  function one(sel, root) { return (root || doc).querySelector(sel); }
  function all(sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }

  // Read the fragment, then drop it from the address bar and history before anything else.
  var params = new URLSearchParams(location.hash.slice(1));
  var page = one("[data-member-page]");
  if (page && location.hash) history.replaceState(null, "", location.pathname + location.search);

  function safeRedirect(r) {
    if (typeof r !== "string" || !/^\/(?!\/)/.test(r) || /[\\\x00-\x1f\x7f]|%(2f|5c)/i.test(r)) return "/";
    try { return new URL(r, location.origin).origin === location.origin ? r : "/"; } catch (e) { return "/"; }
  }
  var redirect = safeRedirect(params.get("redirect"));
  function go() { location.assign(redirect); }

  function call(method, path, body) {
    var init = { method: method, credentials: "same-origin", cache: "no-store", headers: {} };
    if (method === "POST") { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body || {}); }
    return fetch(base + path, init).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) || {} : {}; } catch (e) { data = {}; }
        return { status: res.status, data: data, retryAfter: res.headers.get("Retry-After") };
      });
    }, function () { return { status: 0, data: {} }; });
  }
  var memberRead;
  var identities = [];
  function member() {
    return memberRead || (memberRead = call("GET", "/me").then(function (r) {
      identities = r.status === 200 && Array.isArray(r.data.identities) ? r.data.identities.filter(validProvider) : [];
      return r.status === 200 && r.data.member ? r.data.member : null;
    }));
  }
  // Provider ids become a URL path segment: the same shape the server accepts, or ignored.
  function validProvider(p) {
    var id = p && (p.id || p.providerId);
    return typeof id === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(id) && typeof p.label === "string" && !!p.label;
  }
  function providers() {
    return call("GET", "/login-providers").then(function (r) {
      return r.status === 200 && Array.isArray(r.data.providers) ? r.data.providers.filter(validProvider) : [];
    });
  }
  function startLink(p, text) {
    var a = doc.createElement("a");
    a.className = "@@providerThemeClasses@@ @@providerClass@@";
    a.href = base + "/oidc/" + p.id + "/start";
    a.textContent = text;
    return a;
  }
  function signOut(button) {
    button.disabled = true;
    call("POST", "/sign-out", {}).then(function () { location.reload(); });
  }

  function waitText(r) {
    var details = r.data.details || {};
    var s = parseInt(r.retryAfter, 10) || details.retryAfterSeconds || 0;
    if (!s) return "a moment";
    return s >= 90 ? Math.ceil(s / 60) + " minutes" : s + " seconds";
  }
  // One message per status; 'wrong' is the uniform 401 text for the form that failed.
  function errorText(r, wrong) {
    if (r.status === 0) return "Couldn't reach the site. Check your connection and try again.";
    if (r.status === 429) return "Too many tries. Try again in " + waitText(r) + ".";
    if (r.status === 503) return "Email sign-in isn't set up on this site yet.";
    if (r.status === 401) return wrong;
    if (r.status === 400) return r.data.badRequest || "Check what you entered and try again.";
    return "Something went wrong. Try again.";
  }

  function nav(link, m) {
    if (!m) {
      if (!page) link.href = "/signin#redirect=" + encodeURIComponent(location.pathname + location.search);
      return;
    }
    var account = doc.createElement("a");
    account.href = "/account";
    var full = doc.createElement("span");
    full.className = "@@accountEmailClass@@";
    full.textContent = m.email;
    var short = doc.createElement("span");
    short.className = "@@accountShortClass@@";
    short.textContent = "Account";
    account.append(full, short);
    account.title = m.email;
    account.setAttribute("data-member-account", "");
    var out = doc.createElement("button");
    out.type = "button";
    out.className = link.className;
    out.setAttribute("data-member-nav-sign-out", "");
    out.textContent = "Sign out";
    out.addEventListener("click", function () { signOut(out); });
    link.replaceWith(account, out);
  }
  var links = all("[data-member-nav]");
  if (links.length) member().then(function (m) { links.forEach(function (link) { nav(link, m); }); });

  if (!page) return;

  // 'moveFocus' is false only for the first view a page opens on, so loading a page never steals focus.
  // Provider buttons sit above the email forms only; the list loads the first time one is shown.
  var current = "";
  var choices = one("[data-member-providers]", page);
  var choicesRead;
  function showProviders() {
    if (!choices) return;
    var wanted = current === "password" || current === "code-request";
    if (wanted && !choicesRead) choicesRead = providers().then(function (list) {
      var slot = one("[data-member-provider-list]", choices);
      list.forEach(function (p) { slot.append(startLink(p, "Continue with " + p.label)); });
      showProviders();
    });
    choices.hidden = !wanted || !one("[data-member-provider-list] a", choices);
  }
  function show(name, moveFocus) {
    current = name;
    showProviders();
    all("[data-member-view]", page).forEach(function (view) { view.hidden = view.getAttribute("data-member-view") !== name; });
    var view = one('[data-member-view="' + name + '"]', page);
    var focus = moveFocus !== false && view && one("input:not([type=hidden]), [data-member-focus]", view);
    if (focus) focus.focus();
  }
  function setMessage(form, text, kind) {
    var error = one("[data-member-error]", form);
    var ok = one("[data-member-ok]", form);
    if (error) { error.textContent = kind === "error" ? text : ""; error.hidden = kind !== "error"; }
    if (ok) { ok.textContent = kind === "ok" ? text : ""; ok.hidden = kind !== "ok"; }
  }
  function value(form, name) { var field = form.elements[name]; return field ? field.value : ""; }

  var challengeId = "";
  var magicToken = params.get("magic") || "";
  var resetToken = params.get("token") || "";
  var oidc = { provider: params.get("oidc") || "", challengeId: params.get("challengeId") || "", continuation: params.get("continuation") || "" };
  var oidcPending = validProvider({ id: oidc.provider, label: "-" }) && !!oidc.challengeId && !!oidc.continuation;

  // Each handler returns a promise of the server reply, or undefined when it handled the outcome.
  var handlers = {
    password: function (form) {
      return call("POST", "/password/sign-in", { email: value(form, "email").trim(), password: value(form, "password") }).then(function (r) {
        if (r.status === 200) return go();
        setMessage(form, errorText(r, "Wrong email or password."), "error");
      });
    },
    "code-request": function (form) {
      var email = value(form, "email").trim();
      var body = { email: email };
      if (redirect !== "/") body.redirectPath = redirect;
      return call("POST", "/sign-in", body).then(function (r) {
        if (r.status !== 200) {
          r.data.badRequest = "Enter a valid email address.";
          return setMessage(form, errorText(r, ""), "error");
        }
        challengeId = r.data.challengeId || "";
        all("[data-member-email]", page).forEach(function (el) { el.textContent = email; });
        show("code");
      });
    },
    code: function (form) {
      var code = value(form, "code").replace(/\s+/g, "");
      if (!/^\d{6}$/.test(code)) return Promise.resolve(setMessage(form, "Enter the 6-digit code from the email.", "error"));
      return call("POST", "/sign-in/complete", { challengeId: challengeId, code: code }).then(function (r) {
        if (r.status === 200) return go();
        setMessage(form, errorText(r, "That code is wrong or has expired. Check it, or send a new one."), "error");
      });
    },
    magic: function (form) {
      return call("POST", "/sign-in/complete", { token: magicToken }).then(function (r) {
        if (r.status === 200) return go();
        setMessage(form, errorText(r, "This link has expired or was already used. Send yourself a new code."), "error");
      });
    },
    forgot: function (form) {
      return call("POST", "/forgot-password", { email: value(form, "email").trim() }).then(function (r) {
        if (r.status === 200) return show("sent");
        r.data.badRequest = "Enter a valid email address.";
        setMessage(form, errorText(r, ""), "error");
      });
    },
    reset: function (form) {
      return call("POST", "/reset-password", { token: resetToken, password: value(form, "password") }).then(function (r) {
        if (r.status === 200) return show("done");
        r.data.badRequest = r.data.error === "expected nonempty token and password strings" ? "Enter a new password." : r.data.error;
        setMessage(form, errorText(r, "This reset link has expired or was already used. Ask for a new one."), "error");
      });
    },
    "oidc-code": function (form) {
      var code = value(form, "code").replace(/\s+/g, "");
      if (!/^\d{6}$/.test(code)) return Promise.resolve(setMessage(form, "Enter the 6-digit code from the email.", "error"));
      return call("POST", "/oidc/" + oidc.provider + "/verify-email", { continuation: oidc.continuation, challengeId: oidc.challengeId, code: code }).then(function (r) {
        if (r.status === 200) return location.assign(safeRedirect(r.data.returnPath || "/account"));
        setMessage(form, errorText(r, "That code is wrong or has expired. Check it, or start over."), "error");
      });
    },
    set: function (form) {
      var body = { password: value(form, "password") };
      if (value(form, "currentPassword")) body.currentPassword = value(form, "currentPassword");
      var reauth = one("[data-member-reauth]", page);
      if (reauth) reauth.hidden = true;
      return call("POST", "/password/set", body).then(function (r) {
        if (r.status === 200) { form.reset(); return setMessage(form, "Password saved. You're signed out on your other devices.", "ok"); }
        if (r.data.code === "REAUTHENTICATION_REQUIRED") {
          if (reauth) reauth.hidden = false;
          return setMessage(form, "For your safety, sign in again with an emailed code, then set your password.", "error");
        }
        r.data.badRequest = r.data.error;
        setMessage(form, errorText(r, "Your current password is wrong or missing."), "error");
      });
    },
  };

  all("form[data-member-form]", page).forEach(function (form) {
    var handler = handlers[form.getAttribute("data-member-form")];
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var submit = one("button[type=submit]", form);
      setMessage(form, "", "");
      submit.disabled = true;
      form.setAttribute("aria-busy", "true");
      Promise.resolve(handler(form)).then(function () {
        submit.disabled = false;
        form.removeAttribute("aria-busy");
      });
    });
  });
  all("[data-member-show]", page).forEach(function (button) {
    button.addEventListener("click", function () { show(button.getAttribute("data-member-show")); });
  });
  all("[data-member-sign-out]", page).forEach(function (button) {
    button.addEventListener("click", function () { signOut(button); });
  });
  // Native buttons keep keyboard activation and cannot submit the member form.
  all("[data-member-password-toggle]", page).forEach(function (button) {
    var input = doc.getElementById(button.getAttribute("aria-controls"));
    button.addEventListener("click", function () {
      var reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      button.setAttribute("aria-label", button.getAttribute(reveal ? "data-hide-label" : "data-show-label"));
      button.querySelector(".@@passwordSlashClass@@").toggleAttribute("hidden", !reveal);
    });
  });
  all(".@@tipClass@@", page).forEach(function (tip) {
    var text = doc.getElementById(tip.getAttribute("aria-controls"));
    tip.addEventListener("click", function () {
      var open = tip.getAttribute("aria-expanded") !== "true";
      tip.setAttribute("aria-expanded", String(open));
      text.hidden = !open;
    });
    tip.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { tip.setAttribute("aria-expanded", "false"); text.hidden = true; }
    });
  });

  // One plain sentence per fixed code from /signin#oidcError=<CODE>; anything else reads as INVALID.
  var OIDC_ERRORS = {
    LOGIN_CANCELLED: "Sign-in was cancelled. Nothing changed.",
    LOGIN_UNAVAILABLE: "That sign-in option isn't available on this site right now. Sign in with your email instead.",
    LOGIN_BLOCKED: "This account can't sign in that way right now. Sign in with your email instead.",
    LOGIN_CONFLICT: "That account is already connected to a different member of this site.",
    LOGIN_INVALID: "Sign-in didn't finish, so nothing changed. Try again from this page."
  };
  var oidcError = one("[data-member-oidc-error]", page);
  if (oidcError && params.get("oidcError")) {
    oidcError.textContent = OIDC_ERRORS[params.get("oidcError")] || OIDC_ERRORS.LOGIN_INVALID;
    oidcError.hidden = false;
  }

  // /account: a connected provider reads "<Label> connected" + Unlink; an enabled one, "Connect <Label>".
  var accounts = one("[data-member-identities]", page);
  function identityRow(i) {
    var li = doc.createElement("li");
    li.className = "@@identityClass@@";
    var text = doc.createElement("span");
    text.textContent = i.label + " connected";
    var unlink = doc.createElement("button");
    unlink.type = "button";
    unlink.className = "@@linkClass@@";
    unlink.textContent = "Unlink";
    unlink.setAttribute("aria-label", "Unlink " + i.label);
    unlink.addEventListener("click", function () { unlinkIdentity(unlink, i); });
    li.append(text, unlink);
    return li;
  }
  function renderAccounts(available) {
    var list = one("[data-member-identity-list]", accounts);
    var linked = {};
    list.textContent = "";
    identities.forEach(function (i) { linked[i.providerId] = true; list.append(identityRow(i)); });
    available.forEach(function (p) {
      if (linked[p.id]) return;
      var li = doc.createElement("li");
      li.append(startLink(p, "Connect " + p.label));
      list.append(li);
    });
    accounts.hidden = !list.children.length;
  }
  function unlinkIdentity(button, i) {
    var reauth = one("[data-member-reauth]", accounts);
    button.disabled = true;
    reauth.hidden = true;
    setMessage(accounts, "", "");
    call("POST", "/identities/" + i.providerId + "/unlink", {}).then(function (r) {
      button.disabled = false;
      if (r.status === 200) {
        identities = identities.filter(function (x) { return x.providerId !== i.providerId; });
        return providers().then(function (list) {
          renderAccounts(list);
          setMessage(accounts, i.label + " unlinked. You're signed out on your other devices.", "ok");
        });
      }
      if (r.data.code === "LOGIN_BLOCKED") {
        reauth.hidden = false;
        return setMessage(accounts, "For your safety, sign in again with an emailed code, then unlink.", "error");
      }
      setMessage(accounts, errorText(r, "Couldn't unlink. Reload the page and try again."), "error");
    });
  }

  var kind = page.getAttribute("data-member-page");
  if (kind === "reset") return show(resetToken ? "reset" : "missing", false);
  if (kind === "forgot") return show("forgot", false);
  if (kind === "signin" && magicToken) return show("magic", false);
  if (kind === "signin" && oidcPending) return show("oidc-code", false);
  member().then(function (m) {
    all("[data-member-email]", page).forEach(function (el) { el.textContent = m ? m.email : ""; });
    if (kind === "account" && m && accounts) providers().then(renderAccounts);
    if (kind === "account") return show(m ? "account" : "signed-out", false);
    show(m ? "signed-in" : params.get("view") === "code" ? "code-request" : "password", false);
  });
})`;

/** The browser half. `base` is the member API root for this site's workspace. @complexity O(n) in the template. */
export function memberAuthScript({ names: n }: NamesArgs, _optional: NoOptions = {}): string {
  return MEMBER_AUTH_SCRIPT_TEMPLATE.replace(/@@(\w+)@@/g, (_token, key: string) => String(n[key as keyof MemberAuthNames]));
}

/**
 * Adds the member style + script before `</body>` when the page has a member hook (a header
 * `data-member-nav` or a member page) and does not carry them yet; otherwise returns `html`.
 * Same shape as `injectListingScript` (`@jini-ai/cms/listing`).
 * @param required.names The host's class names (see {@link MemberAuthNames}), baked into both the style and the script.
 * @param required.marker The host-owned boolean attribute (e.g. `data-<product>-member-auth`) stamped on both the
 *   `<style>` and the `<script>`; its presence in `html` is the idempotency check, so it must be one fixed name per host.
 * @complexity O(n) in `html`.
 */
export function injectMemberAuthScript({ html, workspaceId, marker, names }: { html: string; workspaceId: string; marker: string; names: MemberAuthNames }, _optional: Record<string, never> = {}): string {
  if (html.includes(marker) || !/\sdata-member-(nav|page)\b/.test(html)) return html;
  const base = JSON.stringify(`/api/members/v1/workspaces/${encodeURIComponent(workspaceId)}`).replace(/</g, "\\u003c");
  const markup = `<style ${marker}>${memberAuthStyle({ names })}</style>` +
    `<script ${marker}>${memberAuthScript({ names })}(${base});</script>`;
  const bodyClose = html.lastIndexOf("</body>");
  return bodyClose === -1 ? html + markup : html.slice(0, bodyClose) + markup + html.slice(bodyClose);
}
