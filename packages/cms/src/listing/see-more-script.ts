/**
 * The inline script behind every see-more button ({@link injectListingScript} adds it once per page).
 * It reveals the `hidden` buttons, then on click fetches the batch URL (`data-jini-more-href`),
 * appends the batch's items to the `[data-jini-listing=key]` container (before the button when the
 * button sits inside that container, so it stays below the cards) and swaps in the next URL, or
 * removes the button after the last batch. While a fetch is in flight the button is disabled,
 * `aria-busy`, and shows its `data-jini-loading` label; a failed fetch restores it.
 */
export const LISTING_SEE_MORE_SCRIPT = `(function(){
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
  fetch(b.getAttribute('data-jini-more-href'),{credentials:'same-origin'}).then(function(r){if(!r.ok)throw new Error(String(r.status));return r.text();}).then(function(text){
  var doc=new DOMParser().parseFromString(text,'text/html');
  var batch=doc.querySelector('[data-jini-listing-batch]');
  if(!batch)throw new Error('no batch');
  var anchor=list.contains(b)?b:null;
  while(batch.firstChild)list.insertBefore(document.adoptNode(batch.firstChild),anchor);
  var next=doc.querySelector('button[data-jini-more]');
  if(next){b.setAttribute('data-jini-more-href',next.getAttribute('data-jini-more-href'));idle();}else{b.parentNode.removeChild(b);}
  }).catch(idle);
  });
  })();`;
