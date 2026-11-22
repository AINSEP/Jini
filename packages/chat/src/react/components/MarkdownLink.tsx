/**
 * @module MarkdownLink
 *
 * The one anchor the chat's markdown draws for a link, so a `[label](url)` and a bare autolink
 * cannot drift apart. Owner decision 2026-11-21, reversing 2026-10-08 (when every chat link opened a
 * new tab so the chat and the page under it were never navigated away from):
 *  - a link to the owner's own site or admin navigates the current tab from its text (the admin's
 *    own link handler turns an admin path into an in-app navigation, so the chat dock stays), with a
 *    small icon right after it that opens a new tab instead;
 *  - a link to any other website opens a new tab, with no icon (it already does);
 *  - a same-document `#anchor` stays in place, with no icon.
 * `ChatPane`'s click guard (`useChatPaneNewTabLinks`) applies the same own-or-other split to links
 * this renderer does not draw.
 */
import type { ReactNode } from 'react';
import { useT } from '../hooks/context.js';
import { Icon } from './Icon.js';
import { currentOrigin, isOwnLinkHref } from './own-link.js';

const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** The icon's label, also its tooltip: it is the only text the icon has. */
const OPEN_IN_NEW_TAB = 'Open in new tab';

export interface MarkdownLinkProps {
  readonly href: string;
  readonly children: ReactNode;
  /** The origin that counts as the owner's own; defaults to the page's own origin. */
  readonly origin?: string;
  readonly useTHook?: typeof useT;
}

export function MarkdownLink({ href, children, origin = currentOrigin(), useTHook = useT }: MarkdownLinkProps) {
  const t = useTHook();
  if (href.startsWith('#')) return <a href={href}>{children}</a>;
  if (!isOwnLinkHref({ href, origin })) return <a href={href} {...NEW_TAB}>{children}</a>;
  const label = t(OPEN_IN_NEW_TAB);
  return (
    <>
      <a href={href}>{children}</a>
      <a className="jini-md-link-newtab" href={href} {...NEW_TAB} aria-label={label} title={label}>
        <Icon name="external-link" size={11} />
      </a>
    </>
  );
}
