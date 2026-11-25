import type { SiteRenderContext } from "../../render-context.js";
import type { JsonObject } from "@jini-ai/core/primitives";
import { escapeHtml } from "@jini-ai/core/text";
import { str, arr, obj } from "../value-readers.js";
import { toAllowedHref } from "../../../../../navigation/href.js";

export function siteHeader(ctx: SiteRenderContext, props: JsonObject): string {
  const compact = props.compact === true;
  const tagline = !compact && typeof props.tagline === "string"
    ? `<p class="tagline">${escapeHtml({ text: props.tagline })}</p>`
    : "";
  // No admin link: under no-theme this header is the site's primary, public-facing output — every
  // visitor sees it — so advertising the admin panel's URL here would hand it to anyone who looks.
  // An operator who deliberately turned the theme off already knows where their own admin lives.
  return `<header class="site-header"><div class="wrap"><a class="wordmark" href="/">${escapeHtml({ text: ctx.siteTitle })}</a>${tagline}<nav class="site-nav"><a href="/">Home</a></nav></div></header>`;
}

/**
 * The footer's "theme: <name>" badge, or nothing at all when the operator turned the theme off.
 *
 * Shared by BOTH footers deliberately. `siteFooter` and `richSiteFooter` each carried their own
 * copy of this span, so suppressing the badge in only the one that is easy to find would have left
 * a themeless site emitting `<span class="theme-badge">theme: </span>` — an empty badge — from the
 * other. One helper makes "both footers agree" structural instead of a thing two edits have to
 * preserve.
 */
function themeBadge(ctx: SiteRenderContext): string {
  if (ctx.themeName === null) return "";
  return `<span class="theme-badge">theme: ${escapeHtml({ text: ctx.themeName })}</span>`;
}

/**
 * The plain footer: site title, an optional host credit line, and the theme badge. The credit is the
 * host's own product copy (`creditText`, e.g. "powered by <product>"), so it is a parameter rather
 * than a literal here; absent, the footer shows the site title alone.
 */
export function siteFooter(ctx: SiteRenderContext, optional: { creditText?: string } = {}): string {
  const credit = optional.creditText === undefined ? "" : ` — ${escapeHtml({ text: optional.creditText })}`;
  return `<footer class="site-footer"><div class="wrap"><span>${escapeHtml({ text: ctx.siteTitle })}${credit}</span>${themeBadge(ctx)}</div></footer>`;
}

/** Sticky nav bar with CSS-only hover dropdowns + a checkbox-driven mobile drawer (no JS). */
export function siteNav(ctx: SiteRenderContext, props: JsonObject): string {
  const brand = escapeHtml({ text: str({ value: props.brand }) || ctx.siteTitle });
  const caret = '<svg class="caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  const items = arr({ value: props.items })
    .map((it) => {
      const o = obj({ value: it });
      if (!o) return "";
      const label = escapeHtml({ text: str({ value: o.label }) });
      const href = escapeHtml({ text: toAllowedHref({ rawHref: o.href }) });
      const children = arr({ value: o.children });
      if (children.length) {
        const sub = children
          .map((c) => {
            const co = obj({ value: c });
            if (!co) return "";
            return `<li><a href="${escapeHtml({ text: toAllowedHref({ rawHref: co.href }) })}">${escapeHtml({ text: str({ value: co.label }) })}</a></li>`;
          })
          .join("");
        return `<li class="nav-item has-children"><a class="nav-link" href="${href}">${label}${caret}</a><ul class="nav-dropdown">${sub}</ul></li>`;
      }
      return `<li class="nav-item"><a class="nav-link" href="${href}">${label}</a></li>`;
    })
    .join("");
  const cta = obj({ value: props.cta });
  const ctaHtml = cta
    ? `<a class="btn btn--primary nav-cta" href="${escapeHtml({ text: toAllowedHref({ rawHref: cta.href }) })}">${escapeHtml({ text: str({ value: cta.label }, { fallback: "Get started" }) })}</a>`
    : "";
  return `<header class="site-header"><div class="wrap nav"><a class="brand" href="/">${brand}</a><input type="checkbox" id="nav-toggle" class="nav-toggle" aria-label="Toggle menu"/><label for="nav-toggle" class="nav-burger"><span></span><span></span><span></span></label><nav class="nav-menu"><ul class="nav-list">${items}</ul>${ctaHtml}</nav></div></header>`;
}

/** Multi-column footer: brand blurb + socials, link columns, legal row. */
export function siteFooterRich(ctx: SiteRenderContext, props: JsonObject): string {
  const brand = escapeHtml({ text: str({ value: props.brand }) || ctx.siteTitle });
  const blurb = str({ value: props.blurb }) ? `<p class="footer__blurb">${escapeHtml({ text: str({ value: props.blurb }) })}</p>` : "";
  const socials = arr({ value: props.social })
    .map((s) => {
      const o = obj({ value: s });
      if (!o) return "";
      return `<a class="footer__social" href="${escapeHtml({ text: toAllowedHref({ rawHref: o.href }) })}">${escapeHtml({ text: str({ value: o.label }) })}</a>`;
    })
    .join("");
  const cols = arr({ value: props.columns })
    .map((c) => {
      const o = obj({ value: c });
      if (!o) return "";
      const links = arr({ value: o.links })
        .map((l) => {
          const lo = obj({ value: l });
          if (!lo) return "";
          return `<li><a href="${escapeHtml({ text: toAllowedHref({ rawHref: lo.href }) })}">${escapeHtml({ text: str({ value: lo.label }) })}</a></li>`;
        })
        .join("");
      return `<div class="footer__col"><h4>${escapeHtml({ text: str({ value: o.title }) })}</h4><ul>${links}</ul></div>`;
    })
    .join("");
  const legal = escapeHtml({ text: str({ value: props.legal }) || `© ${new Date().getFullYear()} ${str({ value: props.brand }) || ctx.siteTitle}` });
  return `<footer class="site-footer site-footer--rich"><div class="wrap footer__top"><div class="footer__brandcol"><a class="brand" href="/">${brand}</a>${blurb}<div class="footer__socials">${socials}</div></div><div class="footer__cols">${cols}</div></div><div class="wrap footer__bottom"><span>${legal}</span>${themeBadge(ctx)}</div></footer>`;
}
