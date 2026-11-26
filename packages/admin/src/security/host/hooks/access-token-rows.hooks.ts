import { useMemo } from "react";
import { buildAccessTokenRows, buildCustomCredentialRows, type AccessTokenRow } from "../../access-token-rows.js";
import { accessTokenProviderInfo } from "../../access-token-providers.js";
import type { AccessTokensArgs } from "./use-access-tokens.hooks.js";
import type { useAccessTokenQueries } from "./access-token-queries.hooks.js";
import type { useAccessTokenStores } from "./access-token-stores.hooks.js";

export function useAccessTokenRows({ args, queries, stores }: { args: AccessTokensArgs; queries: ReturnType<typeof useAccessTokenQueries>; stores: ReturnType<typeof useAccessTokenStores> }, _optional = {}) {
  const { ACCESS_TOKEN_PROVIDER_COPY, LEGACY_SENTINEL_LABELS } = args.deps;
  const { providers, publishTargetsSettled } = queries;
  const { publishCredentials, sourceControlCredentials, customCredentials } = stores;
  const rows = useMemo<AccessTokenRow[] | undefined>(() => {
    if (publishCredentials.status === "pending" || sourceControlCredentials.status === "pending" || customCredentials.status === "pending" || !publishTargetsSettled) return undefined;
    return [
      ...buildAccessTokenRows({ kind: "publish", raws: publishCredentials.rows ?? [], providerLabel: ({ ref }) => accessTokenProviderInfo({ providers, copy: ACCESS_TOKEN_PROVIDER_COPY, ref }).label, sentinelLabels: LEGACY_SENTINEL_LABELS }),
      ...buildAccessTokenRows({ kind: "source-control", raws: sourceControlCredentials.rows ?? [], providerLabel: ({ ref }) => accessTokenProviderInfo({ providers, copy: ACCESS_TOKEN_PROVIDER_COPY, ref }).label, sentinelLabels: LEGACY_SENTINEL_LABELS }),
      ...buildCustomCredentialRows({ raws: customCredentials.rows ?? [] }),
    ];
  }, [publishCredentials, sourceControlCredentials, customCredentials, publishTargetsSettled, providers]);
  return rows;
}
