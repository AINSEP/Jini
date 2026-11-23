import { escapeHtml } from '@jini-ai/core/text';

/** Initial editable copy only; owner edits are never regenerated. Escapes all interpolated text.
 * @param required Site title and seeded owner's contact, when available.
 * @returns Inner HTML with an editor region and a highlighted missing-contact prompt.
 * @complexity O(n) for n interpolated characters; no I/O. */
export function privacyPageTemplate({ siteTitle, email }: { siteTitle: string; email?: string }, _options = {}): string {
  const contact = email?.trim() ? escapeHtml({ text: email }) : '<mark>ADD YOUR CONTACT EMAIL</mark>';
  return `<section data-agent-element="privacy-policy" data-agent-role="region">
<h1>Privacy Policy</h1>
<p>${escapeHtml({ text: siteTitle })} uses necessary cookies to operate this website and remember your cookie choices.</p>
<p>Where present, optional functional cookies support additional features, analytics cookies help measure website use, and marketing cookies support advertising. The cookie banner lets you accept or reject optional categories and change your preferences.</p>
<p>Necessary cookies remain active. Optional content is controlled by your choices.</p>
<p>Questions about privacy? Contact ${contact}.</p>
<p>This page describes this website’s cookie choices. The site owner should edit it to describe any additional collection or use of personal information.</p>
</section>`;
}
