import { Fragment } from 'react';
import type { TabViewProps } from '../../../react/bind-react.js';
import { useProvidersTab } from '../hooks/ProvidersTab.hooks.js';
import { EyeIcon, HiddenEyeIcon, ReloadIcon } from '../components/MediaIcons.js';
export function ProvidersTab(_props: TabViewProps, _optional: Record<string, never> = {}) {
  const vm = useProvidersTab();
  return <section className="jini-media-providers-panel jini-settings-section jini-settings-media-providers" data-jini-part="media.providers" data-theme="light">
    <div className="jini-section-head"><div><h4>Media providers</h4><p className="jini-hint">Credentials this host uses to generate images and video.</p></div>
      <button type="button" className="jini-button jini-button-ghost" data-agent-element="media-providers-reload" onClick={vm.reload} disabled={vm.reloadDisabled}><ReloadIcon /><span>{vm.reloadLabel}</span></button>
    </div>
    {vm.unreachable && <p className="jini-hint jini-hint-error" role="alert">Could not reach the server. Showing local changes only.</p>}
    {vm.empty && <p className="jini-hint">No media providers configured yet.</p>}
    <div className="jini-media-provider-list">{vm.rows.map(row => <Fragment key={row.id}>
      {row.divider && <hr className="jini-media-provider-divider" />}
      <article className="jini-media-provider-card">
        <div className="jini-media-provider-card-head"><strong className="jini-media-provider-name">{row.label}</strong>{row.statusLabel && <span className={row.statusClassName}>{row.statusLabel}</span>}</div>
        <div className="jini-media-provider-fields">
          <label className="jini-media-provider-field jini-media-provider-field--secret"><span className="jini-field-label jini-sr-only">{row.label} credential</span>
            <input className="jini-input" {...row.credentialAttrs} autoComplete="new-password" spellCheck={false} type={row.credentialType} placeholder={row.credentialPlaceholder} value={row.credential} onChange={row.onCredential} disabled={vm.disabled} />
            <button type="button" className="jini-input-affix-btn" aria-label={row.toggleLabel} aria-pressed={row.visible} onClick={row.toggle} disabled={vm.disabled}>{row.visible ? <HiddenEyeIcon /> : <EyeIcon />}</button>
          </label>
          <label className="jini-media-provider-field"><span className="jini-field-label jini-sr-only">{row.baseUrlLabel}</span>
            <input className="jini-input" aria-label={row.baseUrlLabel} placeholder={row.baseUrlPlaceholder} type="url" inputMode="url" spellCheck={false} aria-invalid={row.ariaInvalid} value={row.baseUrl} onChange={row.onBaseUrl} disabled={vm.settingsDisabled} />
          </label>
          {row.hasModels && <label className="jini-media-provider-field"><span className="jini-field-label jini-sr-only">{row.modelLabel}</span>
            <input className="jini-input" aria-label={row.modelLabel} list={row.modelsId} placeholder="Default model" spellCheck={false} value={row.model} onChange={row.onModel} disabled={vm.settingsDisabled} />
            <datalist id={row.modelsId}>{row.models?.map(model => <option key={model} value={model} />)}</datalist>
          </label>}
          <button type="button" className="jini-button jini-button-ghost" data-jini-part="media.provider.remove" aria-label={row.clearLabel} onClick={row.clear} disabled={row.clearDisabled}>Clear</button>
        </div>
        {row.hint && <span className={row.hintClassName} role={row.hintRole}>{row.hint}</span>}
      </article>
    </Fragment>)}</div>
    <div className="jini-media-provider-save-row">
      <button type="button" className="jini-button" data-jini-part="media.provider.save" data-agent-element="media-providers-save" onClick={vm.save} disabled={vm.saveDisabled}>{vm.saveLabel}</button>
      {vm.saved && <span className="jini-hint" role="status">Saved.</span>}
      {vm.saveError && <span className="jini-hint jini-hint-error" role="alert">Could not save media providers.</span>}
    </div>
  </section>;
}
export default ProvidersTab;
