import { readFile } from 'node:fs/promises';
import type { BrowserAnalyticsContribution } from '@jini-ai/analytics/product';

/** Pinned browser distribution; no SDK is fetched until the existing consent owner has a choice. */
export const POSTHOG_BROWSER_VERSION = '1.260.2';
const BROWSER_PATH = '/_jini/browser-analytics/posthog';

/** Browser settings contain only the project's publishable ingestion token, never personal API keys.
 * A fresh named SDK instance on mode change avoids retaining a full-mode identity in cookieless
 * events. Retired clients lose persistence and replay before the replacement starts. O(1) per change.
 */
export function postHogBrowserContribution(required: {
  apiKey: string; host: string; sessionReplay: boolean; surface: 'site' | 'admin';
  attributes: Readonly<Record<string, string>>;
}, { request = fetch, loadAsset = () => readFile(new URL('./posthog-browser.js', import.meta.url), 'utf8') }: { request?: typeof fetch; loadAsset?: () => Promise<string> } = {}): BrowserAnalyticsContribution {
  // This is also a callable adapter boundary: never serialize unvalidated credentials.
  validatePostHogBrowserConfig(required);
  const attributes = required.attributes.site_id ? { site_id: required.attributes.site_id } : {};
  const base = `${BROWSER_PATH}/${required.surface}`;
  const sdk = `${base}/sdk-${POSTHOG_BROWSER_VERSION}.js`;
  const config = JSON.stringify({ ...required, host: base, attributes, sdk }).replace(/</g, '\\u003c');
  return {
    supportsStatic: false,
    supportsLiveConsent: true,
    origins: [],
    http: { path: base, handle: async ({ method, path, body, contentType }) => {
      if (method === 'GET' && path === `/sdk-${POSTHOG_BROWSER_VERSION}.js`) {
        return { status: 200, body: await loadAsset(), contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' };
      }
      if (method !== 'POST' || !/^\/(?:e|batch|i\/v0\/e|s)\/?$/.test(path)) return { status: 404, body: '' };
      // Never forward visitor cookies, IP headers, referrers or vendor Set-Cookie responses.
      // Only a fixed collector path can leave the server; redirects cannot widen that boundary.
      const response = await request(required.host.replace(/\/$/, '') + path + '?ip=0', { method: 'POST',
        headers: { 'content-type': contentType }, body: Buffer.from(body), redirect: 'error', signal: AbortSignal.timeout(5000) });
      await response.body?.cancel();
      return { status: response.ok ? 200 : 502, body: response.ok ? '1' : '' };
    } },
    source: `function(options){
      var config=${config}, current='pending', client=null, loading=null, generation=0;
      function retire(){
        if(!client)return;
        client.stopSessionRecording();
        // Disable persistence first: the SDK removes its previously stored cookie/localStorage.
        // Request batching is disabled, so an unsent full-mode batch cannot survive withdrawal.
        // before_send also rejects subsequent events from the retired instance's listeners.
        client.set_config({disable_persistence:true,autocapture:false,capture_pageview:false,disable_session_recording:true,before_send:function(){return null;}});
        client=null;
      }
      function safePath(path){
        // Preserve page paths while removing email-like path segments and opaque bearer tokens.
        return (path||'/').split('/').map(function(part){
          var decoded;try{decoded=decodeURIComponent(part);}catch(e){return ':redacted';}
          return /@|[a-f0-9]{32,}|[A-Za-z0-9_-]{40,}/i.test(decoded)?':redacted':part;
        }).join('/');
      }
      function maskedChain(chain){
        // Only structural selectors survive; authored ids/classes/attributes/text can hold PII.
        return chain.split(';').slice(0,32).map(function(element){
          var tag=/^[a-z][a-z0-9-]*/i.exec(element);
          var position=/:nth-(?:child|of-type)\\([0-9]+\\)/g;
          return tag?tag[0]+(element.match(position)||[]).join(''):'';
        }).filter(Boolean).join(';');
      }
      function maskedElements(elements){
        return elements.slice(0,32).filter(function(element){return element&&/^[a-z][a-z0-9-]*$/i.test(element.tag_name||'');}).map(function(element){
          var safe={tag_name:element.tag_name};
          ['nth_child','nth_of_type'].forEach(function(key){if(Number.isInteger(element[key])&&element[key]>0)safe[key]=element[key];});
          return safe;
        });
      }
      function clearPersistence(){
        var names=['ph_jini_'+config.surface+'_'+(config.attributes.site_id||'site')+'_posthog','ph_'+config.apiKey+'_posthog'];
        // Previous pages may have granted before this page ever constructed an SDK instance.
        names.forEach(function(name){try{localStorage.removeItem(name);}catch(e){}});
        var domains=[null,location.hostname], parts=(location.hostname||'').split('.');
        for(var i=1;i<parts.length-1;i++)domains.push('.'+parts.slice(i).join('.'));
        names.forEach(function(name){domains.forEach(function(domain){
          document.cookie=name+'=; Max-Age=0; Path=/'+(domain?'; Domain='+domain:'');
        });});
      }
      function fullProperties(event,props,safe){
        ['distinct_id','$device_id','$session_id','$window_id','$is_identified'].forEach(function(name){if(props[name]!==undefined)safe[name]=props[name];});
        safe.$pathname=safePath(location.pathname);safe.$current_url=location.origin+safe.$pathname;
        safe.$host=location.hostname;
        if(typeof props.$elements_chain==='string')safe.$elements_chain=maskedChain(props.$elements_chain);
        if(Array.isArray(props.$elements))safe.$elements=maskedElements(props.$elements);
        if(event.event==='$identify')safe.$set={};
      }
      function safeEvent(event){
        if(current==='pending')return null;
        var props=event.properties||{}, safe={};
        // Autocapture DOM text, attributes, URLs, referrers and input values can contain PII.
        // Keep structural clicks and coarse metadata, never authored content or query strings.
        var names=['$event_type','$el_tag_name','$browser','$browser_version','$os','$device_type','$lib','$lib_version','$viewport_width','$viewport_height'];
        names.forEach(function(name){if(props[name]!==undefined)safe[name]=props[name];});
        safe.$process_person_profile=current==='full';
        if(current==='full')fullProperties(event,props,safe);
        else{
          safe.distinct_id='$posthog_cookieless';
          safe.$pathname=config.surface==='admin'?'/admin':'/';safe.$current_url=location.origin+safe.$pathname;
        }
        Object.assign(safe,config.attributes,{surface:config.surface});
        event.properties=safe;
        return event;
      }
      function start(sdk,mode,version){
        if(version!==generation||mode!==current)return;
        var full=mode==='full';
        var settings={
          api_host:config.host,cookieless_mode:'always',disable_compression:true,
          persistence:'memory',disable_persistence:true,
          persistence_name:'jini_'+config.surface+'_'+(config.attributes.site_id||'site'),
          request_batching:false,mask_all_element_attributes:true,mask_all_text:true,
          person_profiles:'never',autocapture:false,
          capture_pageview:'history_change',capture_pageleave:false,
          disable_session_recording:true,
          session_recording:{maskAllInputs:true,maskTextSelector:'*'},
          disable_surveys:true,advanced_disable_feature_flags:true,disable_web_experiments:true,
          capture_performance:false,capture_heatmaps:false,capture_dead_clicks:false,
          disable_external_dependency_loading:true,
          advanced_disable_flags:true,enable_recording_console_log:false,
          capture_exceptions:false,ip:false,before_send:safeEvent,
          loaded:function(instance){
            if(version!==generation)return;
            // identify(current anonymous ID) is a no-op in 1.260.2. A stable opaque prefix
            // performs the first identification and then reuses the persisted returning ID.
            if(full){var id=instance.get_distinct_id();instance.identify(id.indexOf('visitor:')===0?id:'visitor:'+id);}
          }
        };
        if(full)Object.assign(settings,{cookieless_mode:undefined,persistence:'localStorage+cookie',disable_persistence:false,
          person_profiles:'identified_only',autocapture:{capture_copied_text:false},
          disable_session_recording:!config.sessionReplay});
        client=sdk.init(config.apiKey,settings,'jini_browser_'+config.surface+'_'+version);
      }
      return function(mode){
        if(mode===current)return;
        current=mode;generation+=1;
        retire();
        if(mode!=='full')clearPersistence();
        if(mode==='pending')return;
        var version=generation;
        // Dynamic import is owned by this plugin; the generic bridge never names a vendor.
        if(!loading)loading=(options&&options.loadSdk?options.loadSdk():import(config.sdk)).then(function(module){return module.default;});
        loading.then(function(sdk){start(sdk,mode,version);}).catch(function(){loading=null;});
      };
    }`,
  };
}

/** Reject private tokens and credential-bearing endpoints before any browser source exists.
 * Errors are fixed copy: submitted values must never enter diagnostics. O(input bytes).
 */
export function validatePostHogBrowserConfig({ apiKey, host }: { apiKey: string; host: string }, _optional = {}): void {
  if (!/^phc_[A-Za-z0-9_]+$/.test(apiKey)) throw new TypeError('Use a PostHog project key starting with phc_, not a personal API key.');
  let url: URL;
  try { url = new URL(host); } catch { throw new TypeError('Use an HTTP or HTTPS host URL without credentials.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TypeError('Use an HTTP or HTTPS host URL without credentials.');
  }
}

