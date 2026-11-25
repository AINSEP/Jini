import type { JsonValue, JsonObject } from "@jini-ai/core/primitives";
import { obj, str, arr } from "../value-readers.js";
import { escapeHtml } from "@jini-ai/core/text";
import { toAllowedHref } from "../../../../../navigation/href.js";
import type { DocRenderClasses } from "../doc/doc-render-contract.js";
import { mediaPlaceholder } from "../media-placeholder.js";

function actionsHtml({ actions }: { actions: JsonValue[] }, _optional = {}): string {
  const links = actions
    .map((a, i) => {
      const o = obj({ value: a });
      if (!o) return "";
      const kind = i === 0 ? "btn btn--primary" : "btn btn--ghost";
      return `<a class="${kind}" href="${escapeHtml({ text: toAllowedHref({ rawHref: o.href }) })}">${escapeHtml({ text: str({ value: o.label }, { fallback: "Learn more" }) })}</a>`;
    })
    .join("");
  return links ? `<div class="actions">${links}</div>` : "";
}

/** Landing hero: optional badge/eyebrow, title, subtitle, actions, optional media. */
export function hero({ props, mediaPlaceholderClasses }: { props: JsonObject; mediaPlaceholderClasses: DocRenderClasses["mediaPlaceholder"] }, _optional = {}): string {
  const badge = str({ value: props.badge }) ? `<span class="hero__badge">${escapeHtml({ text: str({ value: props.badge }) })}</span>` : "";
  const eyebrow = str({ value: props.eyebrow }) ? `<p class="eyebrow">${escapeHtml({ text: str({ value: props.eyebrow }) })}</p>` : "";
  const subtitle = str({ value: props.subtitle }) ? `<p class="hero__sub">${escapeHtml({ text: str({ value: props.subtitle }) })}</p>` : "";
  const mediaProps = obj({ value: props.media });
  const media = mediaProps ? `<div class="hero__media">${mediaPlaceholder({ props: mediaProps, classes: mediaPlaceholderClasses })}</div>` : "";
  return `<section class="hero"><div class="wrap hero__inner"><div class="hero__text">${badge}${eyebrow}<h1 class="hero__title">${escapeHtml({ text: str({ value: props.title }) })}</h1>${subtitle}${actionsHtml({ actions: arr({ value: props.actions }) })}</div>${media}</div></section>`;
}

/** Thin promo strip above the nav. */
export function announcement({ props }: { props: JsonObject }, _optional = {}): string {
  const text = escapeHtml({ text: str({ value: props.text }) });
  if (!text) return "";
  const link = obj({ value: props.link });
  const linkHtml = link
    ? ` <a class="topbar__link" href="${escapeHtml({ text: toAllowedHref({ rawHref: link.href }) })}">${escapeHtml({ text: str({ value: link.label }, { fallback: "Learn more" }) })} →</a>`
    : "";
  return `<div class="topbar"><div class="wrap"><p class="topbar__text">${text}${linkHtml}</p></div></div>`;
}

/** Full-width final call-to-action band. */
export function ctaBand({ props }: { props: JsonObject }, _optional = {}): string {
  const eyebrow = str({ value: props.eyebrow }) ? `<p class="eyebrow eyebrow--on-dark">${escapeHtml({ text: str({ value: props.eyebrow }) })}</p>` : "";
  const subtitle = str({ value: props.subtitle }) ? `<p class="cta__sub">${escapeHtml({ text: str({ value: props.subtitle }) })}</p>` : "";
  return `<section class="cta"><div class="wrap"><div class="cta__inner">${eyebrow}<h2 class="cta__title">${escapeHtml({ text: str({ value: props.title }) })}</h2>${subtitle}${actionsHtml({ actions: arr({ value: props.actions }) })}</div></div></section>`;
}

function paragraphsHtml({ items }: { items: JsonValue[] }, _optional = {}): string {
  return items.map((p) => `<p>${escapeHtml({ text: str({ value: p }) })}</p>`).join("");
}

function bulletsHtml({ items }: { items: JsonValue[] }, _optional = {}): string {
  const lis = items.map((b) => `<li>${escapeHtml({ text: str({ value: b }) })}</li>`).join("");
  return lis ? `<ul class="ticks">${lis}</ul>` : "";
}

/** A content section: eyebrow/title/lead/body/bullets, optional side media + actions. */
export function section({ props, mediaPlaceholderClasses }: { props: JsonObject; mediaPlaceholderClasses: DocRenderClasses["mediaPlaceholder"] }, _optional = {}): string {
  const id = str({ value: props.id }) ? ` id="${escapeHtml({ text: str({ value: props.id }) })}"` : "";
  const mediaObj = obj({ value: props.media });
  const side = str({ value: props.side }, { fallback: "right" }) === "left" ? "section--media-left" : "section--media-right";
  const eyebrow = str({ value: props.eyebrow }) ? `<p class="eyebrow">${escapeHtml({ text: str({ value: props.eyebrow }) })}</p>` : "";
  const title = str({ value: props.title }) ? `<h2 class="section__title">${escapeHtml({ text: str({ value: props.title }) })}</h2>` : "";
  const lead = str({ value: props.lead }) ? `<p class="section__lead">${escapeHtml({ text: str({ value: props.lead }) })}</p>` : "";
  const text = `<div class="section__text">${eyebrow}${title}${lead}${paragraphsHtml({ items: arr({ value: props.body }) })}${bulletsHtml({ items: arr({ value: props.bullets }) })}${actionsHtml({ actions: arr({ value: props.actions }) })}</div>`;
  const media = mediaObj ? `<div class="section__media">${mediaPlaceholder({ props: mediaObj, classes: mediaPlaceholderClasses })}</div>` : "";
  const layout = media ? side : "section--plain";
  return `<section class="section ${layout}"${id}><div class="wrap section__inner">${text}${media}</div></section>`;
}

/** A 3-up (auto-fill) grid of labelled feature cards. */
export function featureGrid({ props }: { props: JsonObject }, _optional = {}): string {
  const eyebrow = str({ value: props.eyebrow }) ? `<p class="eyebrow">${escapeHtml({ text: str({ value: props.eyebrow }) })}</p>` : "";
  const title = str({ value: props.title }) ? `<h2 class="section__title">${escapeHtml({ text: str({ value: props.title }) })}</h2>` : "";
  const cards = arr({ value: props.items })
    .map((it) => {
      const o = obj({ value: it });
      if (!o) return "";
      const tag = str({ value: o.tag }) ? `<span class="feature__tag">${escapeHtml({ text: str({ value: o.tag }) })}</span>` : "";
      return `<article class="feature"><div class="feature__head">${tag}<h3 class="feature__title">${escapeHtml({ text: str({ value: o.title }) })}</h3></div><p class="feature__body">${escapeHtml({ text: str({ value: o.body }) })}</p></article>`;
    })
    .join("");
  return `<section class="feature-grid"><div class="wrap"><header class="feature-grid__head">${eyebrow}${title}</header><div class="features">${cards}</div></div></section>`;
}
