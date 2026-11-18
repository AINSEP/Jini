import type { ReactNode } from "react";
import { InfoTip } from "../../../react/kit.js";

export interface SeoSectionProps {
  title: string;
  /** Optional ⓘ explanation beside the title (explanations are tips, never loose paragraphs). */
  tip?: string;
  children: ReactNode;
}

/**
 * One titled group on this screen — title in the left rail, controls in the right column. Markup
 * only; every visual decision and the reasoning for the rail lives in `styles/seo.css`'s header.
 *
 * This is the 1:1 replacement for the `<div className="field-group"><h2 className="card-title">`
 * pair `56e87ae0` introduced, and the swap is deliberately structure-preserving: the section body
 * carries `.field-group`'s exact `flex-column` + `--space-4` gap, so the fields inside are laid
 * out identically and NOTHING becomes conditional. That matters more here than anywhere else in
 * this file — `SeoDefaultsTab` submits via `new FormData(e.currentTarget)`, so a field that stops
 * being mounted is simply absent from the payload and silently saves as blank. A wrapper element
 * cannot unmount anything, and `Seo.unit.test.tsx`'s "keeps every defaults field inside ONE form"
 * pins all seven names, in order, against exactly that.
 *
 * Fixed `<h2>` rather than a `level` prop: both callers are top-level groups under the page `H1`,
 * and the one heading on this screen that is genuinely subordinate — `SeoEntryPanel`'s "Per-entry
 * overrides", which sits INSIDE the "Per-entry SEO" section — keeps its own `<h3>` and is not
 * routed through here.
 */
export function SeoSection({ title, tip, children }: SeoSectionProps) {
  return (
    <section className="jini-seo-section">
      <div className="jini-seo-section-head">
        <h2 className="jini-seo-section-title">
          {title}
          {tip ? <InfoTip label={tip} /> : null}
        </h2>
      </div>
      <div className="jini-seo-section-body">{children}</div>
    </section>
  );
}
