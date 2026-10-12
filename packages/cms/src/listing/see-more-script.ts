/**
 * The inline script behind every see-more button ({@link injectListingScript} adds it once per page).
 * It reveals the `hidden` buttons, then on click fetches the batch URL (`data-jini-more-href`),
 * appends the batch's items to the `[data-jini-listing=key]` container (before the button when the
 * button sits inside that container, so it stays below the cards) and swaps in the next URL, or
 * removes the button after the last batch. While a fetch is in flight the button is disabled,
 * `aria-busy`, and shows its `data-jini-loading` label; a failed fetch restores it.
 *
 * A `.json` batch URL (the listing has a `<template data-jini-card>`) is read as a
 * {@link ListingJsonPage}: each item fills a copy of that card and the next URL is built from
 * `nextCursor`. Bindings: `data-field="path"` sets `textContent`; `data-field-<attr>="path"` sets one of
 * href/src/alt/title/datetime/width/height, and href/src only when relative or http(s). A text or
 * href/src binding with no value removes its element. Data is never parsed as HTML.
 */
export const LISTING_SEE_MORE_SCRIPT = `(function(){
  var ATTRS={href:1,src:1,alt:1,title:1,datetime:1,width:1,height:1};
  function value(item,path){var v=item;var keys=path.split('.');for(var i=0;i<keys.length&&v!=null;i++)v=Object.prototype.hasOwnProperty.call(v,keys[i])?v[keys[i]]:undefined;if(Array.isArray(v))v=v.join(', ');return v==null||typeof v==='object'?'':String(v);}
  function fill(root,item){
  var els=root.querySelectorAll('*');
  for(var i=0;i<els.length;i++){var el=els[i];var drop=false;
  for(var a=el.attributes.length-1;a>=0;a--){var name=el.attributes[a].name;if(name!=='data-field'&&name.indexOf('data-field-')!==0)continue;
  var v=value(item,el.attributes[a].value);el.removeAttribute(name);
  if(name==='data-field'){if(v==='')drop=true;else el.textContent=v;continue;}
  var attr=name.slice(11);if(!ATTRS[attr])continue;
  var link=attr==='href'||attr==='src';
  if(link&&/^\\s*[a-z][a-z0-9+.-]*:/i.test(v)&&!/^\\s*https?:/i.test(v))v='';
  if(v!=='')el.setAttribute(attr,v);else if(link)drop=true;}
  if(drop&&el.parentNode)el.parentNode.removeChild(el);}
  return root;}
  var buttons=document.querySelectorAll('button[data-jini-more]');
  for(var i=0;i<buttons.length;i++)buttons[i].hidden=false;
  document.addEventListener('click',function(e){
  var b=e.target&&e.target.closest?e.target.closest('button[data-jini-more]'):null;
  if(!b||b.disabled)return;
  var list=document.querySelector('[data-jini-listing="'+b.getAttribute('data-jini-more')+'"]');
  if(!list||!window.fetch||!window.DOMParser)return;
  var label=b.textContent;
  function idle(){b.disabled=false;b.removeAttribute('aria-busy');b.textContent=label;}
  b.disabled=true;b.setAttribute('aria-busy','true');b.textContent=b.getAttribute('data-jini-loading')||label;
  var href=b.getAttribute('data-jini-more-href')||'';
  var json=/\\.json$/.test(href.split(/[?#]/)[0]);
  var tpl=json?list.querySelector('template[data-jini-card]'):null;
  if(json&&!tpl)return idle();
  fetch(href,{credentials:'same-origin'}).then(function(r){if(!r.ok)throw new Error(String(r.status));return r.text();}).then(function(text){
  var anchor=list.contains(b)?b:null;
  if(json){
  var data=JSON.parse(text);
  if(!data||!Array.isArray(data.items))throw new Error('no batch');
  for(var n=0;n<data.items.length;n++)list.insertBefore(fill(tpl.content.cloneNode(true),data.items[n]),anchor);
  if(typeof data.nextCursor==='number'){b.setAttribute('data-jini-more-href',href.replace(/\\/\\d+\\.json/,'/'+data.nextCursor+'.json'));idle();}else{b.parentNode.removeChild(b);}
  return;
  }
  var doc=new DOMParser().parseFromString(text,'text/html');
  var batch=doc.querySelector('[data-jini-listing-batch]');
  if(!batch)throw new Error('no batch');
  while(batch.firstChild)list.insertBefore(document.adoptNode(batch.firstChild),anchor);
  var next=doc.querySelector('button[data-jini-more]');
  if(next){b.setAttribute('data-jini-more-href',next.getAttribute('data-jini-more-href'));idle();}else{b.parentNode.removeChild(b);}
  }).catch(idle);
  });
  })();`;
