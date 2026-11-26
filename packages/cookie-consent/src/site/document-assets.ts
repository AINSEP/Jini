import type { ConsentConfig, DeclaredScript, RawContribution } from '@jini-ai/core/contracts/site/cookie-consent';
import { renderBanner, renderScriptAssets } from '../render/index.js';
import { siteBannerMode, toSiteCookieConsent } from './cookie-consent.js';

/** Document construction consumes data, never a completed response body. */
export async function siteConsentDocumentAssets(required: {
  readPolicy: () => Promise<ConsentConfig | null>;
  readDeclarations: () => Promise<readonly DeclaredScript[]>;
  hasConsent: boolean;
  preview: () => boolean;
  exporting: () => boolean;
  plugins: (required: { live: boolean }) => Promise<readonly RawContribution[]>;
  scripts: readonly DeclaredScript[];
  static?: true;
  clientSrc: string | undefined;
  extensionSrc: string;
  loaderSrc: string;
  endpoint: string;
}, _optional = {}): Promise<{ head: string; body: string }> {
  const { scripts, static: staticDocument } = required;
  const config = await required.readPolicy();
  if (staticDocument) return staticDocumentAssets({ config, required, scripts });
  const allScripts = [...scripts, ...await required.readDeclarations()];
  if (required.preview()) return { head: renderScriptAssets({ scripts: allScripts.filter(script => script.consent === undefined) }), body: '' };
  if (!config || !required.hasConsent) return { head: renderScriptAssets({ scripts: allScripts.filter(script => script.consent === undefined) }), body: '' };
  if (siteBannerMode({ config }) === 'off') return { head: renderScriptAssets({ scripts: allScripts }), body: '' };
  return renderDocumentConsent({ required, config, scripts: allScripts });
}

/** Static documents share managed shells' cached publication; off-mode declarations need no consent runtime.
 * @complexity O(declared scripts) time/space when off; reuses the cached declaration Promise without I/O. */
async function staticDocumentAssets({ config, required, scripts }: {
  config: ConsentConfig | null; required: Parameters<typeof siteConsentDocumentAssets>[0]; scripts: readonly DeclaredScript[];
}): Promise<{ head: string; body: string }> {
  if (!config || required.preview()) return { head: '', body: '' };
  if (siteBannerMode({ config }) === 'off') {
    const allScripts = [...scripts, ...await required.readDeclarations()];
    return { head: renderScriptAssets({ scripts: allScripts }), body: '' };
  }
  return { head: `<script src="${required.loaderSrc}" defer data-jini-consent-loader></script>`, body: '' };
}

/** Render the shared banner and client assets once a usable snapshot has been selected. */
async function renderDocumentConsent({ required, config, scripts }: {
  required: Parameters<typeof siteConsentDocumentAssets>[0]; config: ConsentConfig; scripts: readonly DeclaredScript[];
}): Promise<{ head: string; body: string }> {
  const live = !required.exporting();
  const plugins = await required.plugins({ live });
  const { banner, options } = toSiteCookieConsent({ config, policy: config.policyVersion }, { plugins });
  const rendered = renderBanner({ ...banner, client: { ...banner.client, scripts, ...(live ? { context: `${required.endpoint}/context` } : {}) } }, {
    ...options, ...(required.clientSrc === undefined ? {} : { clientSrc: required.clientSrc }), extensionSrc: required.extensionSrc,
    evidence: live ? { mode: 'durable', endpoint: required.endpoint } : { mode: 'local' },
  });
  return { head: rendered.head, body: rendered.body + '<a class="jini-consent-settings" href="#privacy-choices" data-consent-open>Cookie settings</a>' };
}

/** JSON declaration URLs are invisible to an HTML crawler. No live collectors enter an export. */
export async function siteConsentExportAssets({ readPolicy, readDeclarations, hasConsent, client, extensionSrc }: {
  readPolicy: () => Promise<ConsentConfig | null>;
  readDeclarations: () => Promise<readonly DeclaredScript[]>;
  hasConsent: () => boolean;
  client: () => { src: string } | undefined;
  extensionSrc: string;
}, _optional = {}): Promise<readonly string[]> {
  const config = await readPolicy();
  const declared = await readDeclarations();
  const local = declared.filter(script => script.src.startsWith('/') && (config || script.consent === undefined)).map(script => script.src);
  if (!config || siteBannerMode({ config }) === 'off') return local;
  if (!hasConsent()) throw new Error('cookie consent export has no consent configuration');
  const loadedClient = client();
  return [...(loadedClient ? [loadedClient.src] : []), extensionSrc, ...local];
}

export function staticConsentLoaderScript({ head, body, exporting }: { head: string; body: string; exporting: boolean }, _optional = {}): string {
  return `(()=>{
      if(document.getElementById('jini-consent-config'))return;
      const template=document.createElement('template');template.innerHTML=${JSON.stringify(head + body)};
      ${exporting ? String.raw`// Only this server-owned contribution is rebased, never the authored document.
      const base=document.currentScript?new URL('..',document.currentScript.src).pathname.replace(/\/$/,''):'';
      const prefix=value=>typeof value==='string'&&/^\/(?!\/)/.test(value)?base+value:value;
      for(const node of template.content.querySelectorAll('[src],[href]')){
        for(const attr of ['src','href'])if(node.hasAttribute(attr))node.setAttribute(attr,prefix(node.getAttribute(attr)));}
      const config=template.content.querySelector('#jini-consent-config');
      if(config)config.textContent=JSON.stringify(JSON.parse(config.textContent),(key,value)=>key==='src'?prefix(value):value);` : ''}
      const scripts=[];
      for(const node of [...template.content.childNodes]){
        if(node.nodeName==='SCRIPT'&&node.getAttribute('src'))scripts.push(node);
        else document.body.append(node);
      }
      for(const node of scripts){const script=document.createElement('script');
        for(const attr of node.attributes)script.setAttribute(attr.name,attr.value);
        script.async=false;document.body.append(script);}
    })();`;
}
