import type { AdminDescriptorI18n, AdminPublishTargetCredentialSpec, AdminPublishTargetDescriptor, AdminPublishTargetField } from "../../deployment/api/deployment-api.types.js";
import type { AdminSourceControlProviderDescriptor } from "../../source-control/api/source-control-api.types.js";

/**
 * @file Renders a plugin descriptor's own text (host labels, help, credential guidance) in the
 * viewer's locale, from the `i18n` block the plugin ships beside it (`{ locale: { English: translation } }`,
 * see the server's parser, `@jini-ai/core/text`'s `parseDescriptorI18n`). The admin names no host string: a
 * plugin translates its own copy, and any string without a translation stays in its English.
 *
 * Applied once where a hook receives descriptors ({@link localizePublishTargets},
 * {@link localizeSourceControlProviders}), so every component downstream renders translated text
 * without a lookup of its own. Pure.
 */

/**
 * One descriptor string in `locale`: the exact locale's entry, else its base language's (`pt` for
 * `pt-BR`), else the English it was given.
 *
 * @complexity O(1).
 */
export function descriptorText({ i18n, locale, english }: { i18n: AdminDescriptorI18n | undefined; locale: string; english: string }, _optional: Record<string, never> = {}): string {
  if (i18n === undefined) return english;
  const exact = i18n[locale]?.[english];
  if (exact !== undefined) return exact;
  // `String#split` always yields at least one element (`"".split("-")` is `[""]`), so `?? locale` never fires; it only narrows the index type.
  const base = locale.split("-")[0] ?? locale;
  return (base !== locale ? i18n[base]?.[english] : undefined) ?? english;
}

type Text = (required: { english: string }, optional?: Record<string, never>) => string;

function localizeField(field: AdminPublishTargetField, text: Text): AdminPublishTargetField {
  return {
    ...field,
    label: text({ english: field.label }),
    ...(field.help !== undefined ? { help: text({ english: field.help }) } : {}),
    ...(field.userHelp !== undefined ? { userHelp: text({ english: field.userHelp }) } : {}),
  };
}

function localizeCredential<C extends { help?: string; userHelp?: string; fields: AdminPublishTargetField[] }>(credential: C, text: Text): C {
  return {
    ...credential,
    ...(credential.help !== undefined ? { help: text({ english: credential.help }) } : {}),
    ...(credential.userHelp !== undefined ? { userHelp: text({ english: credential.userHelp }) } : {}),
    fields: credential.fields.map((field) => localizeField(field, text)),
  };
}

/**
 * Publish targets with their person-facing text in `locale`. Ids, field names and URLs are untouched.
 * `undefined` (not yet loaded) stays `undefined`.
 *
 * @complexity O(t·f) in targets times declared fields.
 */
export function localizePublishTargets({ targets, locale }: { targets: readonly AdminPublishTargetDescriptor[] | undefined; locale: string }, _optional: Record<string, never> = {}): AdminPublishTargetDescriptor[] | undefined {
  return targets?.map((target) => {
    const text: Text = ({ english }, _optional = {}) => descriptorText({ i18n: target.i18n, locale, english });
    const credential: AdminPublishTargetCredentialSpec | undefined =
      target.credential === undefined
        ? undefined
        : {
            ...localizeCredential(target.credential, text),
            ...(target.credential.vendorLabel !== undefined ? { vendorLabel: text({ english: target.credential.vendorLabel }) } : {}),
          };
    return {
      ...target,
      label: text({ english: target.label }),
      configFields: target.configFields.map((field) => localizeField(field, text)),
      ...(credential !== undefined ? { credential } : {}),
      ...(target.projectName !== undefined
        ? { projectName: { label: text({ english: target.projectName.label }), ...(target.projectName.help !== undefined ? { help: text({ english: target.projectName.help }) } : {}) } }
        : {}),
    };
  });
}

/**
 * Source-control hosts with their person-facing text in `locale`. Ids, field names and URLs are
 * untouched.
 *
 * @complexity O(p·f) in hosts times declared fields.
 */
export function localizeSourceControlProviders({ providers, locale }: { providers: readonly AdminSourceControlProviderDescriptor[]; locale: string }, _optional: Record<string, never> = {}
): AdminSourceControlProviderDescriptor[] {
  return providers.map((provider) => {
    const text: Text = ({ english }, _optional = {}) => descriptorText({ i18n: provider.i18n, locale, english });
    return {
      ...provider,
      label: text({ english: provider.label }),
      ...(provider.credential !== undefined ? { credential: localizeCredential(provider.credential, text) } : {}),
    };
  });
}
