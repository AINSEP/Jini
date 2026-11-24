/**
 * @file Site browser diagnostics: the consent-bridge module that, only under full analytics consent,
 * reports one buffered navigation timing and error/unhandled-rejection codes to the host's
 * `/_jini/browser-analytics/site/diagnostics` endpoint, and the server half that admits a report as a
 * fixed-name observability metric. Off unless the observability adapter admits metrics AND the
 * host's telemetry consent setting is an explicit `true` (a read error means off).
 *
 * Host-injected: `consentSetting` (which settings key holds the operator's telemetry consent).
 */
import { getEffective, type SettingsRepoPort } from '@jini-ai/core/settings';
import { orFallback, orFallbackSync } from '@jini-ai/core/errors/idioms';
import type { ObservabilityPort } from '@jini-ai/core/contracts/observability';

/** The settings key (namespace + key) whose explicit `true` turns diagnostics on. */
export interface BrowserDiagnosticsConsentSetting { namespace: string; key: string }

export interface BrowserDiagnosticsDeps {
  settingsRepo?: SettingsRepoPort;
  workspaceId?: string;
  observability?: ObservabilityPort;
}

export async function browserDiagnosticsEnabled({ observability, consentSetting }: { observability?: ObservabilityPort; consentSetting: BrowserDiagnosticsConsentSetting }, { settingsRepo, workspaceId }: Pick<BrowserDiagnosticsDeps, 'settingsRepo' | 'workspaceId'> = {}): Promise<boolean> {
  if (observability?.supportsMetric !== true || !settingsRepo || !workspaceId) return false;
  return orFallback({ work: async () => (await getEffective({ deps: { repo: settingsRepo }, namespace: consentSetting.namespace, key: consentSetting.key, scopeContext: { workspaceId } }))?.value === true,
    fallback: false, step: 'Read browser diagnostics enablement' });
}

export async function receiveBrowserDiagnostics({ body, contentType }: { body: Uint8Array; contentType: string }, { deps }: { deps: Required<Pick<BrowserDiagnosticsDeps, 'observability'>> & Pick<BrowserDiagnosticsDeps, 'settingsRepo' | 'workspaceId'> & { consentSetting: BrowserDiagnosticsConsentSetting } }) {
  if (!(await browserDiagnosticsEnabled({ observability: deps.observability, consentSetting: deps.consentSetting }, deps))) return { status: 404, body: '' };
  if ((contentType.split(';', 1)[0] ?? '').trim().toLowerCase() !== 'application/json') return { status: 415, body: '' };
  if (body.byteLength > 256) return { status: 413, body: '' };
  const entries = orFallbackSync({ work: () => {
    const parsed: unknown = JSON.parse(Buffer.from(body).toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return [];
    return Object.entries(parsed);
  }, fallback: [], step: 'Read browser diagnostics payload' });
  if (entries.length !== 1) return { status: 400, body: '' };
  const accepted = await entries.map(async ([key, value]: [string, unknown]) => {
    if (key === 'navigationMs' && typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 600_000) {
      await deps.observability.metric({ name: 'browser.navigation.duration', value }, { kind: 'histogram', unit: 'ms', attributes: { surface: 'site' } });
      return true;
    }
    if (key === 'errorKind' && (value === 1 || value === 2)) {
      await deps.observability.metric({ name: value === 1 ? 'browser.error' : 'browser.unhandled_rejection', value: 1 }, { kind: 'counter', attributes: { surface: 'site' } });
      return true;
    }
    return false;
  })[0];
  return { status: accepted ? 204 : 400, body: '' };
}

const browserDiagnosticsSource = String.raw`function({ target, report }, options = {}) {
  const controller = new target.AbortController();
  let observer, navigationSent = false;
  if (target.PerformanceObserver) {
    observer = new target.PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const navigationMs = entry.duration;
        if (navigationSent || !Number.isFinite(navigationMs) || navigationMs <= 0) continue;
        navigationSent = true;
        report({ body: { navigationMs }, signal: controller.signal });
        observer.disconnect();
        break;
      }
    });
    observer.observe({ type: 'navigation', buffered: true });
  }
  const error = () => report({ body: { errorKind: 1 }, signal: controller.signal });
  const rejection = () => report({ body: { errorKind: 2 }, signal: controller.signal });
  target.addEventListener('error', error);
  target.addEventListener('unhandledrejection', rejection);
  return () => {
    target.removeEventListener('error', error);
    target.removeEventListener('unhandledrejection', rejection);
    observer?.disconnect();
    controller.abort();
  };
}`;

export const siteBrowserDiagnosticsBridge = { id: 'site-browser-diagnostics', kind: 'consent-bridge', src: '/_jini/browser-analytics/site/diagnostics.js' };

export const siteBrowserDiagnosticsModule = `const collect = ${browserDiagnosticsSource};
export default {
  id: 'site-browser-diagnostics', kind: 'consent-bridge',
  mount({ api, doc }) {
    let dispose;
    const reconcile = state => {
      if (state.analyticsLevel === 'full') {
        if (!dispose) dispose = collect({ target: doc.defaultView, report: ({ body, signal }) => {
          void doc.defaultView.fetch('/_jini/browser-analytics/site/diagnostics', { method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal }).catch(() => undefined);
        } });
      } else { dispose?.(); dispose = undefined; }
    };
    const unsubscribe = api.subscribe({ listener: reconcile });
    reconcile(api.get());
    return () => { unsubscribe(); dispose?.(); };
  }
};`;
