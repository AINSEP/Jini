import { createElement, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import * as library from '../../pages/WidgetsLibrary.js';
import * as editor from '../../pages/WidgetInstanceEditor.js';
import * as regions from '../../pages/WidgetRegions.js';
import * as region from '../../pages/WidgetRegionEditor.js';
import { WidgetsPortsContext, WidgetsOptionsContext } from '../../hooks/WidgetsPorts.hooks.js';
import type { WidgetsSlots } from '../../hooks/WidgetsPorts.hooks.js';
import { useApi } from './bridge.js';
import { api } from './api.js';
import { events } from './events.js';
import { defaultConfig, widgetTypes, slugRedirectPath } from './catalog.js';
import { t as translate } from './widgets-i18n.js';
import { widgetInstanceGuard } from './rules.js';
export { widgetInstanceGuard };
export const WidgetsLibraryNotices = library.WidgetsLibraryNotices;
export const WidgetRegionEditorHeaderActions = region.WidgetRegionEditorHeaderActions;
/** Test slots verify callback/translation propagation; the real shared UI's suites stay in the host. */
const ConfigFields: WidgetsSlots['ConfigFields'] = ({ config, onChange, t = key => key, agentHandle }) => (
  <label>{t('Text')}<textarea aria-label={t('Text')} value={typeof config.body === 'string' ? config.body : ''} onChange={e => onChange({ ...config, body: e.target.value })} data-agent-handle={agentHandle ? `${agentHandle}-body` : undefined} /></label>
);
const AddControl: WidgetsSlots['AddControl'] = ({ triggerLabel, onResolved }) => {
  const [open, setOpen] = useState(false), [rows, setRows] = useState<Array<{ id: string; title: string }>>([]), [expanded, setExpanded] = useState(false), [selected, setSelected] = useState('');
  useEffect(() => { if (open) void api.listWidgets({ widgetType: 'text' }).then(r => setRows(r.widgets)); }, [open]);
  return <><button onClick={() => setOpen(true)}>{triggerLabel}</button>{open ? <div role="dialog"><button role="combobox" aria-label="Existing Text widgets" onClick={() => setExpanded(true)}>{selected}</button>{expanded ? rows.map(w => <button key={w.id} role="option" onClick={() => { setSelected(w.id); setExpanded(false); }}>{w.title}</button>) : null}<button onClick={() => { onResolved(selected); setOpen(false); }}>Use this widget</button></div> : null}</>;
};
function Host({ children, locale: explicitLocale }: { children: ReactNode; locale?: string | undefined }) {
  const [locale, setLocale] = useState(explicitLocale ?? 'en');
  useEffect(() => {
    if (explicitLocale) { setLocale(explicitLocale); return; }
    // Locale-loader traffic belongs to this copied host harness, never to the module.
    void fetch('/api/admin/v1/workspaces/workspace-local/settings/effective').then(r => r.json()).then((r: { data?: Array<{ key: string; value: string }> | undefined }) => setLocale(r.data?.find(x => x.key === 'locale')?.value ?? 'en')).catch(() => {});
  }, [explicitLocale]);
  const moduleApi = useApi(api);
  const t = useMemo(() => (key: string) => translate({ locale, key }), [locale]);
  const slots = useMemo<WidgetsSlots>(() => ({ ConfigFields: props => createElement(ConfigFields, { ...props, t }), AddControl }), [t]);
  return <WidgetsPortsContext.Provider value={{ widgetsApi: moduleApi, widgetsEvents: events }}><WidgetsOptionsContext.Provider value={{ slots, widgetTypes, defaultConfig, t, locale, slugRedirectPath }}>{children}</WidgetsOptionsContext.Provider></WidgetsPortsContext.Provider>;
}
export function WidgetsLibrary(props: library.WidgetsLibraryProps = {}) { return <Host><library.WidgetsLibrary {...props} /></Host>; }
export function WidgetRegions(props: regions.WidgetRegionsProps = {}) { return <Host locale="en"><regions.WidgetRegions {...props} /></Host>; }
export function WidgetRegionEditor(props: region.WidgetRegionEditorProps) { return <Host locale="en"><region.WidgetRegionEditor {...props} /></Host>; }
export function WidgetInstanceEditor(props: editor.WidgetInstanceEditorProps) {
  // Injected hooks describe the host locale for the retained slot-translation assertion.
  const useHook = props.useWidgetInstanceEditorHook;
  if (useHook) return <InjectedEditor props={props} useHook={useHook} />;
  return <Host><editor.WidgetInstanceEditor {...props} /></Host>;
}
function InjectedEditor({ props, useHook }: { props: editor.WidgetInstanceEditorProps; useHook: NonNullable<editor.WidgetInstanceEditorProps['useWidgetInstanceEditorHook']> }) {
  const result = useHook({ widgetId: props.widgetId, widgetType: props.widgetType });
  return <Host locale={result.locale}><editor.WidgetInstanceEditor {...props} useWidgetInstanceEditorHook={() => result} /></Host>;
}
