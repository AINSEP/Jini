import { useMemo } from "react";
import { accessTokenProviders } from "../../access-token-providers.js";
import type { AccessTokensArgs } from "./use-access-tokens.hooks.js";

export function useAccessTokenQueries({ port, locale, hooks, deps }: AccessTokensArgs, _optional = {}) {
  const { useFetchQuery } = hooks;
  const { localizePublishTargets, localizeSourceControlProviders, sourceControlProviderInfoFromDescriptor, ACCESS_TOKEN_PROVIDER_COPY } = deps;
  const publishQuery = useFetchQuery({ key: ["security", "publish-credentials"], fetch: () => port.publish.list() });
  const sourceControlQuery = useFetchQuery({ key: ["security", "source-control-credentials"], fetch: () => port.sourceControl.list() });
  const customQuery = useFetchQuery({ key: ["security", "custom-credentials"], fetch: () => port.custom.list() });
  // The deploy hosts are data from the deploy registry. A failed load leaves only source-control
  // and custom providers named; saved publish rows still list, under their own ids.
  const publishTargetsQuery = useFetchQuery({ key: ["security", "publish-targets"], fetch: () => port.publishTargets.list() });
  // The source-control hosts come from plugins the same way; a failed load names none of them.
  const sourceControlProvidersQuery = useFetchQuery({ key: ["security", "source-control-providers"], fetch: () => port.sourceControlProviders.list() });
  const providers = useMemo(
    // Each host's own text (labels, guidance, extra-field labels) in the viewer's locale.
    () =>
      accessTokenProviders(
        { publishTargets: localizePublishTargets({ targets: publishTargetsQuery.data, locale }), copy: ACCESS_TOKEN_PROVIDER_COPY, sourceControlProviderInfo: descriptor => sourceControlProviderInfoFromDescriptor({ descriptor }) },
        sourceControlProvidersQuery.data === undefined ? {} : { sourceControlProviders: localizeSourceControlProviders({ providers: sourceControlProvidersQuery.data, locale }) }
      ),
    [publishTargetsQuery.data, sourceControlProvidersQuery.data, locale]
  );
  // The existing catalogs own ids and labels; no parallel provider list lives in this UI.
  const worksForOptions = useMemo(() => Array.from(new Map([
    ...(localizePublishTargets({ targets: publishTargetsQuery.data, locale }) ?? []).map(target => [target.id, { value: target.id, label: target.label }] as const),
    ...(localizeSourceControlProviders({ providers: sourceControlProvidersQuery.data ?? [], locale })).map(provider => [provider.id, { value: provider.id, label: provider.label }] as const),
  ]).values()), [publishTargetsQuery.data, sourceControlProvidersQuery.data, locale]);
  const publishTargetsSettled = publishTargetsQuery.status !== "loading" && sourceControlProvidersQuery.status !== "loading";
  return { publishQuery, sourceControlQuery, customQuery, publishTargetsQuery, sourceControlProvidersQuery, providers, worksForOptions, publishTargetsSettled };
}
