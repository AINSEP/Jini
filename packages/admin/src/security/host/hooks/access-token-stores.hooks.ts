import { useEffect, useRef, useState } from "react";
import type { AdminCustomCredentialSummary, AdminPublishCredentialSummary } from "../../api/security-api.types.js";
import type { AdminSourceControlCredentialSummary } from "../../../source-control/api/source-control-api.types.js";
import type { useAccessTokenQueries } from "./access-token-queries.hooks.js";

export function useAccessTokenStores({ queries }: { queries: ReturnType<typeof useAccessTokenQueries> }, _optional = {}) {
  const { publishQuery, sourceControlQuery, customQuery } = queries;
  const [publishCredentials, setPublishCredentials] = useState<{ status: "pending" | "ok" | "error"; rows?: AdminPublishCredentialSummary[] }>({ status: "pending" });
  const [sourceControlCredentials, setSourceControlCredentials] = useState<{ status: "pending" | "ok" | "error"; rows?: AdminSourceControlCredentialSummary[] }>({ status: "pending" });
  const [customCredentials, setCustomCredentials] = useState<{ status: "pending" | "ok" | "error"; rows?: AdminCustomCredentialSummary[] }>({ status: "pending" });

  const publishSeededRef = useRef(false);
  useEffect(() => {
    if (publishSeededRef.current || publishQuery.status === "loading") return;
    if (publishQuery.status === "error") { publishSeededRef.current = true; setPublishCredentials({ status: "error" }); return; }
    if (!publishQuery.data) return;
    publishSeededRef.current = true;
    setPublishCredentials({ status: "ok", rows: publishQuery.data.credentials });
  }, [publishQuery.status, publishQuery.data]);

  const sourceControlSeededRef = useRef(false);
  useEffect(() => {
    if (sourceControlSeededRef.current || sourceControlQuery.status === "loading") return;
    if (sourceControlQuery.status === "error") { sourceControlSeededRef.current = true; setSourceControlCredentials({ status: "error" }); return; }
    if (!sourceControlQuery.data) return;
    sourceControlSeededRef.current = true;
    setSourceControlCredentials({ status: "ok", rows: sourceControlQuery.data.credentials });
  }, [sourceControlQuery.status, sourceControlQuery.data]);

  const customSeededRef = useRef(false);
  useEffect(() => {
    if (customSeededRef.current || customQuery.status === "loading") return;
    if (customQuery.status === "error") { customSeededRef.current = true; setCustomCredentials({ status: "error" }); return; }
    if (!customQuery.data) return;
    customSeededRef.current = true;
    setCustomCredentials({ status: "ok", rows: customQuery.data.credentials });
  }, [customQuery.status, customQuery.data]);

  return { publishCredentials, setPublishCredentials, sourceControlCredentials, setSourceControlCredentials, customCredentials, setCustomCredentials };
}
