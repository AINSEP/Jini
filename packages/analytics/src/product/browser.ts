/** Browser behavior is contributed by the selected analytics provider, never by a vendor in core. */
export type BrowserAnalyticsMode = 'pending' | 'anonymous' | 'full';
export interface BrowserAnalyticsConsent { hasChoice: boolean; analytics: boolean; gpc?: boolean }
export interface BrowserAnalyticsContribution {
  /** Trusted plugin code: a function expression returning a `(mode) => void` controller. */
  readonly source: string;
  /** Exact origins required by this contribution, including anonymous delivery. */
  readonly origins: readonly string[];
  readonly supportsStatic: boolean;
  /** Mode changes retire identities/replay synchronously before starting the next mode. */
  readonly supportsLiveConsent?: boolean;
}

/** Explicit choice is required even in opt-out regions. GPC can only remove a grant. O(1). */
export function resolveBrowserAnalyticsMode(required: BrowserAnalyticsConsent, _optional = {}): BrowserAnalyticsMode {
  if (!required.hasChoice) return 'pending';
  return required.analytics === true && required.gpc !== true ? 'full' : 'anonymous';
}

/** Render only the provider-neutral consent bridge; SDK factories stay idle until a choice.
 * The consent owner publishes effective choices (including failed withdrawals and GPC), so this
 * bridge never interprets cookies or creates another consent record. O(contribution source bytes).
 */
export function renderBrowserAnalytics(required: {
  contributions: readonly BrowserAnalyticsContribution[];
  surface: 'site' | 'admin';
  delivery: 'live' | 'static';
  consent?: BrowserAnalyticsConsent;
}, _optional = {}): string {
  const contributions = required.contributions.filter(item => required.delivery !== 'static' || item.supportsStatic);
  if (!contributions.length) return '';
  const initial = JSON.stringify(required.consent ?? null).replace(/</g, '\\u003c');
  const factories = contributions.map(item => `(${item.source})`).join(',');
  // A plugin source is executable trusted code; escape script end tags at the HTML sink too.
  const source = `(function(){
    var factories=[${factories}], controllers=null;
    var resolveMode=${resolveBrowserAnalyticsMode.toString()};
    var initial=${initial}, surface=${JSON.stringify(required.surface)};
    if(surface==='site')window.jiniBrowserAnalyticsLive=${contributions.every(item => item.supportsLiveConsent === true)};
    function apply(state){
      var gpc=state&&state.gpc===true||navigator.globalPrivacyControl===true;
      var mode=resolveMode({hasChoice:!!state&&state.hasChoice,analytics:!!state&&state.analytics,gpc:gpc});
      if(surface==='admin'&&mode!=='full')mode='pending';
      if(mode==='pending'&&!controllers)return;
      if(!controllers)controllers=factories.map(function(factory){try{return factory();}catch(e){return function(){};}});
      controllers.forEach(function(control){try{control(mode);}catch(e){window.jiniBrowserAnalyticsLive=false;}});
    }
    window.addEventListener('jini:consent-changed',function(event){if(surface==='site')apply(event.detail);});
    window.addEventListener('jini:metrics-consent-changed',function(event){if(surface==='admin')apply({hasChoice:event.detail===true,analytics:event.detail===true});});
    apply(initial||(surface==='site'?window.jiniConsent:null));
  })();`.replace(/<\/script/gi, '<\\/script');
  return `<script data-jini-browser-analytics>${source}</script>`;
}

/** Insert the trusted contribution once; the consent engine has already bounded live HTML.
 * Exports include only contributions that explicitly support static delivery. O(HTML bytes).
 */
export function injectBrowserAnalytics(required: Parameters<typeof renderBrowserAnalytics>[0] & { html: string }, _optional = {}): string {
  if (required.html.includes('data-jini-browser-analytics')) return required.html;
  const script = renderBrowserAnalytics(required);
  if (!script) return required.html;
  const end = required.html.toLowerCase().lastIndexOf('</body>');
  if (end === -1) return required.html + script;
  return required.html.slice(0, end) + script + required.html.slice(end);
}
