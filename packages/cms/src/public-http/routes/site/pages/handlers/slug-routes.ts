import { checkSiteRelativeTarget } from '../../../../../routing/site/reserved-paths.js';

/** Nested public paths: redirect rules, then the normal 404. */
export async function nestedPageRoute({ path, tryRedirectPhase }: {
  path: string;
  tryRedirectPhase: (required: { phase: 'pre_content' | 'post_content'; path: string }) => Promise<boolean>;
}, _optional = {}): Promise<{ kind: 'next' } | { kind: 'handled' }> {
  if (checkSiteRelativeTarget({ raw: path }).kind !== 'ok') return { kind: 'next' };
  if (await tryRedirectPhase({ phase: 'pre_content', path })) return { kind: 'handled' };
  if (await tryRedirectPhase({ phase: 'post_content', path })) return { kind: 'handled' };
  return { kind: 'next' };
}
