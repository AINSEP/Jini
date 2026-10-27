/** Browser behavior is contributed by the selected analytics provider, never by a vendor in core. */
export type BrowserAnalyticsMode = 'pending' | 'anonymous' | 'full';
export interface BrowserAnalyticsConsent { hasChoice: boolean; analytics: boolean; gpc?: boolean }
export interface BrowserAnalyticsContribution {
  /** Trusted plugin code: a function expression returning a `(mode) => void` controller. */
  readonly source: string;
  /** Exact origins required by this contribution, including anonymous delivery. */
  readonly origins: readonly string[];
  readonly supportsStatic: boolean;
  /** Server-only same-origin asset/collection adapter. Never serialized into page source.
   * The host admits collection with its existing consent owner before invoking this port. */
  readonly http?: {
    readonly path: string;
    handle(required: { method: string; path: string; body: Uint8Array; contentType: string }, optional?: Record<string, never>): Promise<{ status: number; body: string | Uint8Array; contentType?: string; cacheControl?: string }>;
  };
  /** Mode changes retire identities/replay synchronously before starting the next mode. */
  readonly supportsLiveConsent?: boolean;
  /** Host-owned live check; a changed revision retires this page's SDKs until reload. */
  readonly configuration?: { readonly url: string; readonly revision: string };
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
  const configurations = JSON.stringify([...new Map(contributions.filter(item => item.configuration).map(item => [item.configuration!.url, item.configuration!] as const)).values()]).replace(/</g, '\\u003c');
  // A plugin source is executable trusted code; escape script end tags at the HTML sink too.
  const source = `(function(){
    var factories=[${factories}], controllers=null, invalidated=false, active=false, checks=[];
    var resolveMode=${resolveBrowserAnalyticsMode.toString()};
    var initial=${initial}, surface=${JSON.stringify(required.surface)};
    if(surface==='site')window.jiniBrowserAnalyticsLive=${contributions.every(item => item.supportsLiveConsent === true)};
    function adminMode(mode){
      if(mode!=='full')return 'pending';
      try{return window.localStorage.getItem('jini:metrics-withdrawal')==='1'?'pending':mode;}catch(e){return mode;}
    }
    function requestedMode(state){
      state=state||{};
      var mode=resolveMode({hasChoice:state.hasChoice===true,analytics:state.analytics===true,
        gpc:state.gpc===true||navigator.globalPrivacyControl===true});
      return surface==='admin'?adminMode(mode):mode;
    }
    function apply(state){
      if(invalidated)return;
      var mode=requestedMode(state);
      var wasActive=active;active=mode!=='pending';
      if(active&&!wasActive)checks.forEach(function(check){check();});
      if(mode==='pending'&&!controllers)return;
      if(!controllers)controllers=factories.map(function(factory){try{return factory();}catch(e){return function(){};}});
      controllers.forEach(function(control){try{control(mode);}catch(e){window.jiniBrowserAnalyticsLive=false;}});
    }
    var key='jini:analytics-consent:'+surface, channel=null;
    try{if(typeof BroadcastChannel!=='undefined')channel=new BroadcastChannel(key);}catch(e){}
    function receive(state){
      // Cross-document signals may withdraw, never manufacture a grant from stale tab state.
      if(state&&state.analytics===false)apply(state);
    }
    function changed(state){
      apply(state);
      try{window.localStorage.setItem(key,JSON.stringify(state));}catch(e){}
      try{if(channel)channel.postMessage(state);}catch(e){}
    }
    if(channel)channel.onmessage=function(event){receive(event.data);};
    window.addEventListener('storage',function(event){
      if(event.key!==key&&event.key!==null)return;
      try{receive(event.newValue?JSON.parse(event.newValue):{hasChoice:false,analytics:false});}catch(e){receive({hasChoice:false,analytics:false});}
    });
    window.addEventListener('jini:consent-changed',function(event){if(surface==='site')changed(event.detail);});
    window.addEventListener('jini:metrics-consent-changed',function(event){if(surface==='admin')changed({hasChoice:event.detail===true,analytics:event.detail===true});});
    function invalidate(){
      if(invalidated)return;
      invalidated=true;window.jiniBrowserAnalyticsLive=false;
      if(controllers)controllers.forEach(function(control){try{control('pending');}catch(e){}});
    }
    // A detached/reconfigured server lease cannot revoke an already downloaded SDK itself.
    // Check its opaque revision, and fail closed if the host can no longer confirm it.
    var configurations=${configurations};
    configurations.forEach(function(config){
      var running=false, failures=0;
      async function check(){
        if(running||invalidated||!active||document.visibilityState==='hidden')return;
        running=true;
        try{
          var response=await fetch(config.url,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(5000)});
          if(!response.ok)throw new Error('configuration unavailable');
          var revisions=await response.json();
          if(!Array.isArray(revisions)||revisions.indexOf(config.revision)===-1)invalidate();
          failures=0;
        }catch(e){failures+=1;if(failures>=2)invalidate();}finally{running=false;}
      }
      checks.push(check);
      // Only an explicit choice activates checks; hidden tabs generate no periodic traffic.
      var timer=setInterval(function(){if(invalidated)clearInterval(timer);else check();},120000);
      window.addEventListener('focus',check);
      document.addEventListener('visibilitychange',check);
    });
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
  // Match original offsets: Unicode lowercasing can change the HTML's UTF-16 length.
  let end = -1;
  for (const match of required.html.matchAll(/<\/body>/gi)) end = match.index;
  if (end === -1) return required.html + script;
  return required.html.slice(0, end) + script + required.html.slice(end);
}
