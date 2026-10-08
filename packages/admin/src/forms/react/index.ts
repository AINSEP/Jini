import { createElement } from 'react';
import { bindReact } from '../../core/react/bind-react.js';
import type { ModulePageProps } from '../../core/react/bind-react.js';
import type { AdminInstance } from '../../core/module/types.js';
import type { ReactNode } from 'react';
import { formsModule } from '../forms.module.js';
import { FormsPortsContext, FormsOptionsContext } from './hooks/FormsPorts.hooks.js';
import type { FormsReactOptions } from './hooks/FormsPorts.hooks.js';
export type { FormsReactOptions, FormsPorts } from './hooks/FormsPorts.hooks.js';
export { FormsPortsContext, FormsOptionsContext, useFormsPorts } from './hooks/FormsPorts.hooks.js';
export { useFormsList } from './hooks/use-forms-list.hooks.js';
export { useFormEditor } from './hooks/use-form-editor.hooks.js';
export type { FormsListProps } from './pages/FormsList.js';
export type { FormEditorProps } from './pages/FormEditor.js';
export type { FieldAttributesDialogProps } from './components/FieldAttributesDialog.js';
export interface FormsModulePageProps extends ModulePageProps { readonly formId?: string; readonly params?: Readonly<Record<string, unknown>>; }
/** One scoped module factory; page sections share their draft across route-derived tab changes. */
export function forms(_required: Record<string, never>, options: FormsReactOptions = {}) {
  const react = bindReact({ module: formsModule, views: {
    list: { page: async () => {
      const { FormsList } = await import('./pages/FormsList.js');
      return { default: (_props: ModulePageProps) => createElement(FormsList) };
    }, tabs: {} },
    editor: { page: async () => {
      const { FormEditor } = await import('./pages/FormEditor.js');
      return { default: (props: FormsModulePageProps) => {
        const formId = props.formId ?? props.params?.formId;
        if (typeof formId !== 'string' || !formId) throw new Error('Forms editor page requires formId');
        return createElement(FormEditor, { formId, tab: props.requestedTab === 'submissions' ? 'submissions' : 'fields' });
      } };
    },
    // The editor owns one persistent draft for both route tabs. Section rendering stays in
    // that page; mounting an independent tab view would split or reset the draft.
    tabs: { fields: async () => ({ default: () => null }), submissions: async () => ({ default: () => null }) } },
  } }, { context: FormsPortsContext });
  // Options live above lazy pages so a host locale update changes copy without replacing the
  // page/component identity or discarding its working draft. The factory defaults still apply.
  function Provider({ admin, children, options: liveOptions = options }: { admin: AdminInstance; children: ReactNode; options?: FormsReactOptions }) {
    return createElement(react.Provider, { admin, children: createElement(FormsOptionsContext.Provider, { value: liveOptions }, children) });
  }
  return Object.assign({ ...formsModule }, { react: { ...react, Provider } });
}
