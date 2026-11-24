import { Button, TextField, Notice } from '../../../react/kit.js';
import type { SecurityTranslator } from '../../messages.en.js';
import type { OtherCredentialItem, OtherPlaceholderItem } from './other-credential-rows.js';
/** One configured other-store row. A pure view: every value and callback arrives as a prop. */
export function OtherCredentialRow({ item, saving, t }: { item: OtherCredentialItem; saving: boolean; t: SecurityTranslator }) {
  const name = item.title;
  return <article aria-busy={item.pending}>
    <h3>{name}</h3><p>{item.fact}</p>
    {item.link && <a href={item.link.href}>{t('otherManageAt', { screen: item.link.label })}</a>}
    {item.error && <Notice tone="danger">{item.error}</Notice>}
    {item.canWrite && <>{item.row.supportsReplace && <><TextField label={t('otherNewKey', { name })} type="password" value={item.token} onValueChange={item.onToken} disabled={saving} attrs={{ 'data-agent-private': 'true' }} />
      <Button onPress={item.replace} disabled={saving}>{t('otherReplace', { name })}</Button></>}<Button onPress={item.remove} disabled={saving}>{t('otherRemove', { name })}</Button></>}
  </article>;
}
/** A store with nothing saved: Create lives on the store's own screen, so only the deep link is offered. */
export function OtherCredentialPlaceholder({ item, t }: { item: OtherPlaceholderItem; t: SecurityTranslator }) {
  return <article><h3>{item.title}</h3><p>{item.note}</p>{item.link && <a href={item.link.href}>{t('otherManageAt', { screen: item.link.label })}</a>}</article>;
}
