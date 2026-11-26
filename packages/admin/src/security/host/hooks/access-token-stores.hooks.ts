import { useEffect, useRef, useState } from "react";
import type { AdminCustomCredentialSummary, AdminPublishCredentialSummary } from "../../api/security-api.types.js";
import type { AdminSourceControlCredentialSummary } from "../../../source-control/api/source-control-api.types.js";
import type { useAccessTokenQueries } from "./access-token-queries.hooks.js";

export function useAccessTokenStores({ queries }: { queries: ReturnType<typeof useAccessTokenQueries> }, _optional = {}) {
  const { publishQuery, sourceControlQuery, customQuery } = queries;
  const [publishCredentials, setPublishCredentials] = useState<AdminPublishCredentialSummary[] | undefined>(undefined);
  const [sourceControlCredentials, setSourceControlCredentials] = useState<AdminSourceControlCredentialSummary[] | undefined>(undefined);
  const [customCredentials, setCustomCredentials] = useState<AdminCustomCredentialSummary[] | undefined>(undefined);

  const publishSeededRef = useRef(false);
  useEffect(() => {
    if (publishSeededRef.current || publishQuery.status === "loading" || !publishQuery.data) return;
    publishSeededRef.current = true;
    setPublishCredentials(publishQuery.data.credentials);
  }, [publishQuery.status, publishQuery.data]);

  const sourceControlSeededRef = useRef(false);
  useEffect(() => {
    if (sourceControlSeededRef.current || sourceControlQuery.status === "loading" || !sourceControlQuery.data) return;
    sourceControlSeededRef.current = true;
    setSourceControlCredentials(sourceControlQuery.data.credentials);
  }, [sourceControlQuery.status, sourceControlQuery.data]);

  const customSeededRef = useRef(false);
  useEffect(() => {
    if (customSeededRef.current || customQuery.status === "loading" || !customQuery.data) return;
    customSeededRef.current = true;
    setCustomCredentials(customQuery.data.credentials);
  }, [customQuery.status, customQuery.data]);

  return { publishCredentials, setPublishCredentials, sourceControlCredentials, setSourceControlCredentials, customCredentials, setCustomCredentials };
}
