import { Button, Dialog } from '../../../react/kit.js';
import type { SharedKeysDialogProps, useSharedKeysDialog } from '../hooks/SharedKeysDialog.hooks.js';
/** "Use a saved key": one selection approves a Shared Key for this site; a key saved on another site joins Shared Keys first.
 * Parts are marked `data-jini-part="security.shared-keys.*"` for host stylesheets. */
export function SharedKeysDialog({ useSharedKeysDialogHook, ...props }: SharedKeysDialogProps & { useSharedKeysDialogHook: typeof useSharedKeysDialog }) {
  const vm = useSharedKeysDialogHook(props); const { t } = vm;
  return <>
    <Button onPress={vm.show}>{t('sharedKeysOpen')}</Button>
    {vm.open && <Dialog open title={t('sharedKeysOpen')} onClose={vm.cancel} pending={vm.pending}>
      <div data-jini-part="security.shared-keys.source"><p>{t('sharedKeysIntro')}</p>{vm.loading && <span role="status">{t('sharedKeysLoading')}</span>}{vm.empty && <span>{t('sharedKeysEmpty')}</span>}</div>
      <div data-jini-part="security.shared-keys.list">{vm.keys.map(key => <label key={key.id}><input type="radio" name="jini-shared-key" value={key.id} checked={key.checked} onChange={key.select} disabled={vm.locked || Boolean(key.locked)} />{key.text}{key.worksFor && <span> · {key.worksFor}</span>}{key.locked && <span> {key.locked}</span>}</label>)}</div>
      {vm.omissions.map(omission => <p key={omission.id}>{omission.text}</p>)}
      {vm.error && <span role="alert">{vm.error}</span>}
      {vm.results.length > 0 && <ul aria-live="polite" data-jini-part="security.shared-keys.results">{vm.results.map(result => <li key={result.key}>{result.text}</li>)}</ul>}
      <Button onPress={vm.cancel} disabled={vm.pending}>{t('cancel')}</Button><Button onPress={vm.submit} disabled={vm.disabled}>{t('sharedKeysSubmit')}</Button>
    </Dialog>}
  </>;
}
