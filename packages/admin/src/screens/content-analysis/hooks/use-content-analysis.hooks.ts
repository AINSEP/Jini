import { useRef, useState } from "react";

import { useFetchMutation, useFetchQuery } from "../../../react/kit.js";
import { t as translate } from "../content-analysis-i18n.js";
import {
  CONTENT_ANALYZER_PLUGIN_ID,
  buildContentAnalysisView,
  currentAnalysis,
  describeAnalysisError,
  isContentAnalysisHidden,
  previewAnalysis,
  previewRequestBody,
  type ContentAnalysisView,
  type FreshAnalysis,
  type PluginPreviewRequest,
} from "../rules.js";
import type { ContentAnalysisPort } from "./content-analysis-port.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file `ContentAnalysisCard`'s state and its one action — the post editor's Content analysis card
 * for the `content-analyzer` plugin (AW-7 Tier 2).
 *
 * - The card shows only while the plugin is enabled, read from the preview route's own status
 *   (`content.write`, the gate the preview itself uses — not the admin plugin list). Read with
 *   `staleTime: 0`: the Plugins screen toggles plugins without going through this cache, so a
 *   cached "disabled" must not outlive a trip there and back. A refused or failed read shows the
 *   card with the error instead of hiding it (`rules.ts`'s `isContentAnalysisHidden`).
 * - On load it shows the analysis the plugin stored on the post's last save
 *   (`ext["content-analyzer"].report`). "Analyze now" runs the plugin's preview over the editor's
 *   CURRENT title and body — unsaved edits included — and shows that instead, until the next save
 *   brings back a freshly stored one (`rules.ts`'s `currentAnalysis`).
 *
 * `port`/`locale` are injected — see `content-analysis-port.hooks.ts`. `ContentAnalysisCard` resolves
 * them from its required `port` and `useAdminLocale` props (both supplied by the host); a test
 * composes this hook with `createFakeContentAnalysisPort`.
 */

export interface ContentAnalysisTarget {
  post: { id: string; version: number; ext?: Record<string, Record<string, unknown>> };
  /** The editor's current (possibly unsaved) title. */
  title: string;
  /** The editor's current (possibly unsaved) TipTap JSON; `null` before TipTap mounts. */
  bodyJson: unknown;
}

export interface ContentAnalysisDependencies {
  port: ContentAnalysisPort;
  locale: string;
}

export interface ContentAnalysisController {
  /** The plugin is off or not installed, or its status has not loaded — the card renders nothing. */
  hidden: boolean;
  view: ContentAnalysisView;
  analyzing: boolean;
  error: string | null;
  /** Runs the plugin's preview over the current draft. Never rejects; a failure lands in `error`. */
  analyze: () => Promise<void>;
  t: Translate;
}

const STATUS_KEY = ["content-analysis", "preview-status"] as const;

export function useContentAnalysis(props: ContentAnalysisTarget, deps: ContentAnalysisDependencies): ContentAnalysisController {
  const { port, locale } = deps;
  const { post } = props;
  const t: Translate = (key) => translate({ locale: locale, key: key });
  const statusQuery = useFetchQuery({ key: STATUS_KEY, fetch: () => port.previewStatus({ pluginId: CONTENT_ANALYZER_PLUGIN_ID }) }, { staleTime: 0 });
  const previewMutation = useFetchMutation({
    run: ({ input: body }: { input: PluginPreviewRequest }) => port.previewPlugin({ target: { pluginId: CONTENT_ANALYZER_PLUGIN_ID }, body }),
  });
  const [fresh, setFresh] = useState<FreshAnalysis | null>(null);
  // `disabled={analyzing}` only lands on the next render; a double click's second click arrives
  // before it, so the in-flight run is tracked synchronously too.
  const inFlight = useRef(false);

  async function analyze() {
    if (inFlight.current) return;
    inFlight.current = true;
    // Tagged with the version the draft was sent against, so a save landing mid-flight wins.
    const basis = { postId: post.id, version: post.version };
    try {
      const response = await previewMutation.mutate({ input: previewRequestBody({ postId: post.id, title: props.title, bodyJson: props.bodyJson }) });
      setFresh({ ...basis, state: previewAnalysis(response.fields) });
    } catch {
      // Reported through `previewMutation.error` below; the shown analysis stays as it was.
    } finally {
      inFlight.current = false;
    }
  }

  return {
    hidden: isContentAnalysisHidden(statusQuery),
    view: buildContentAnalysisView({ state: currentAnalysis({ post, fresh }), t }),
    analyzing: previewMutation.status === "pending",
    error: describeCardError({ error: previewMutation.error ?? statusQuery.error, t }),
    analyze,
    t,
  };
}

/** The card's error line: the latest Analyze-now failure, else a failed status read. @complexity O(1). */
function describeCardError({ error, t }: { error: unknown; t: Translate }, _optional = {}): string | null {
  return error ? describeAnalysisError({ error, t }) : null;
}
