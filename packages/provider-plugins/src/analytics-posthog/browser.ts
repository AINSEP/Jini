import type { BrowserAnalyticsContribution } from '@jini-ai/analytics/product';

/** Pinned browser distribution; no SDK is fetched until the existing consent owner has a choice. */
export const POSTHOG_BROWSER_VERSION = '1.260.2';
const SDK_URL = `https://cdn.jsdelivr.net/npm/posthog-js@${POSTHOG_BROWSER_VERSION}/+esm`;

/** Browser settings contain only the project's publishable ingestion token, never personal API keys.
 * A fresh named SDK instance on mode change avoids retaining a full-mode identity in cookieless
 * events. Retired clients lose persistence and replay before the replacement starts. O(1) per change.
 */
export function postHogBrowserContribution(required: {
  apiKey: string; host: string; sessionReplay: boolean; surface: 'site' | 'admin';
  attributes: Readonly<Record<string, string>>;
}, _optional = {}): BrowserAnalyticsContribution {
  const config = JSON.stringify({ ...required, sdk: SDK_URL }).replace(/</g, '\\u003c');
  return {
    supportsStatic: false,
    supportsLiveConsent: true,
    origins: ['https://cdn.jsdelivr.net', new URL(required.host).origin, ...assetOrigins({ host: required.host })],
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
      function safeEvent(event){
        if(current==='pending')return null;
        var props=event.properties||{}, safe={};
        // Autocapture DOM text, attributes, URLs, referrers and input values can contain PII.
        // Keep click counts and coarse browser metadata, never authored content or query strings.
        var names=['$event_type','$el_tag_name','$browser','$browser_version','$os','$device_type','$lib','$lib_version','$viewport_width','$viewport_height'];
        if(current==='full')names=names.concat(['distinct_id','$device_id','$session_id','$window_id','$is_identified']);
        names.forEach(function(name){if(props[name]!==undefined)safe[name]=props[name];});
        if(current==='anonymous')safe.distinct_id='$posthog_cookieless';
        safe.$process_person_profile=current==='full';
        safe.$current_url=location.origin+(config.surface==='admin'?'/admin':'/');
        safe.$pathname=config.surface==='admin'?'/admin':'/';
        Object.assign(safe,config.attributes,{surface:config.surface});
        if(event.event==='$identify'&&current==='full')safe.$set={};
        event.properties=safe;
        return event;
      }
      function start(sdk,mode,version){
        if(version!==generation||mode!==current)return;
        var full=mode==='full';
        var settings={
          api_host:config.host,cookieless_mode:'always',
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
          disable_session_recording:!config.sessionReplay,disable_external_dependency_loading:!config.sessionReplay});
        client=sdk.init(config.apiKey,settings,'jini_browser_'+config.surface+'_'+version);
      }
      return function(mode){
        if(mode===current)return;
        current=mode;generation+=1;
        retire();
        if(mode==='pending')return;
        var version=generation;
        // Dynamic import is owned by this plugin; the generic bridge never names a vendor.
        if(!loading)loading=(options&&options.loadSdk?options.loadSdk():import(config.sdk)).then(function(module){return module.default;});
        loading.then(function(sdk){start(sdk,mode,version);}).catch(function(){loading=null;});
      };
    }`,
  };
}

/** Cloud SDK extensions use a separate asset origin; self-hosted installations keep their host. */
function assetOrigins({ host }: { host: string }, _optional = {}): string[] {
  const cloud = /^https:\/\/(us|eu)\.i\.posthog\.com\/?$/.exec(host);
  return cloud ? [`https://${cloud[1]}-assets.i.posthog.com`] : [];
}
