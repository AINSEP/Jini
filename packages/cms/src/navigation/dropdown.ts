/**
 * Dropdown navigation (`"variant":"dropdown"` menus), following the APG disclosure-navigation
 * pattern: a branch item carries a server-rendered `<button class="jini-menu-toggle" aria-expanded
 * aria-controls>` pointing at its child `<ul id>`, and the root `<ul>` carries `data-jini-dropdown`.
 * No `role="menu"` and no `aria-haspopup` — those make screen readers announce a menu and expect
 * menubar keys, which site nav should not imitate.
 *
 * The toggles are real buttons in the markup (not injected by JS), so without JS Tab still reaches
 * them and a theme's `:focus-within` CSS opens the panel. {@link MENU_DROPDOWN_SCRIPT} adds
 * `jini-menu-js` to each root so a theme can switch that fallback off once JS owns the open state
 * (otherwise Escape could not close a panel while focus sits on its toggle).
 */

const SCRIPT_MARKER = 'data-jini-menu-dropdown-script';

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A branch item's toggle. Split form (default): an empty button labelled "`label` submenu" that sits
 *  after the item's link. `asLabel`: the button IS the item's label (a link-less parent), and carries
 *  `menu-item-label` so theme scripts that read `.menu-item-label` treat it as an inert parent.
 *  @complexity O(n) over `label`. */
export function renderMenuToggle(
  { controlsId, label }: { controlsId: string; label: string },
  { asLabel = false }: { asLabel?: boolean } = {}
): string {
  const id = escapeAttribute(controlsId);
  const text = escapeAttribute(label);
  return asLabel
    ? `<button type="button" class="menu-item-label jini-menu-toggle" aria-expanded="false" aria-controls="${id}">${text}</button>`
    : `<button type="button" class="jini-menu-toggle" aria-expanded="false" aria-controls="${id}" aria-label="${text} submenu"></button>`;
}

/**
 * The inline script behind every `[data-jini-dropdown]` menu ({@link injectMenuDropdownScript} adds it
 * once per page). State lives in `li.jini-menu-open` and the toggle's `aria-expanded`.
 * - click on a toggle opens/closes its item (mouse, touch tap, Enter/Space); any click or focus
 *   elsewhere closes every open item that does not contain the target (siblings, click-outside,
 *   tabbing out). Closing an item closes its open descendants too.
 * - Escape closes the nearest open item around the focus and returns focus to its toggle.
 * - ArrowDown on a toggle opens it and focuses the submenu's first link/button; ArrowDown/ArrowUp
 *   inside a submenu move between sibling items; ArrowLeft/ArrowRight on a top-level item move between
 *   top-level items. No wrap at either end. Handled arrows `preventDefault` so the page does not scroll.
 * Hover stays pure theme CSS and never touches `aria-expanded`.
 */
export const MENU_DROPDOWN_SCRIPT = `(function(){
  var roots=document.querySelectorAll('[data-jini-dropdown]');
  for(var i=0;i<roots.length;i++)roots[i].classList.add('jini-menu-js');
  function inMenu(el){return el&&el.closest&&el.closest('[data-jini-dropdown]')?el:null;}
  function toggleOf(li){return li.querySelector(':scope > .jini-menu-toggle');}
  function panelOf(li){var b=toggleOf(li);return b?document.getElementById(b.getAttribute('aria-controls')):null;}
  function first(li){return li?li.querySelector('a[href], button'):null;}
  function setOpen(li,open){
  var items=open?[li]:[li].concat(Array.prototype.slice.call(li.querySelectorAll('li.jini-menu-open')));
  for(var i=0;i<items.length;i++){items[i].classList[open?'add':'remove']('jini-menu-open');var b=toggleOf(items[i]);if(b)b.setAttribute('aria-expanded',open?'true':'false');}
  }
  function closeAll(keep){
  var open=document.querySelectorAll('[data-jini-dropdown] li.jini-menu-open');
  for(var i=0;i<open.length;i++)if(!(keep&&keep.nodeType===1&&open[i].contains(keep)))setOpen(open[i],false);
  }
  document.addEventListener('focusin',function(e){closeAll(e.target);});
  document.addEventListener('click',function(e){
  closeAll(e.target);
  var b=inMenu(e.target)?e.target.closest('.jini-menu-toggle'):null;
  if(b)setOpen(b.parentNode,b.getAttribute('aria-expanded')!=='true');
  });
  document.addEventListener('keydown',function(e){
  var t=inMenu(e.target);if(!t)return;
  if(e.key==='Escape'){var o=t.closest('li.jini-menu-open');if(o){setOpen(o,false);toggleOf(o).focus();}return;}
  var li=t.closest('li'),next=null;if(!li)return;
  var top=li.parentNode.hasAttribute('data-jini-dropdown');
  if(e.key==='ArrowDown'&&t.classList.contains('jini-menu-toggle')){closeAll(li);setOpen(li,true);var p=panelOf(li);next=p?first(p):null;}
  else if(!top&&e.key==='ArrowDown')next=first(li.nextElementSibling);
  else if(!top&&e.key==='ArrowUp')next=first(li.previousElementSibling);
  else if(top&&e.key==='ArrowRight')next=first(li.nextElementSibling);
  else if(top&&e.key==='ArrowLeft')next=first(li.previousElementSibling);
  else return;
  e.preventDefault();
  if(next)next.focus();
  });
  })();`;

/** Adds the one inline dropdown script before `</body>` when the page carries a `data-jini-dropdown`
 *  menu and does not already have the script. @complexity O(n). */
export function injectMenuDropdownScript({ html }: { html: string }, _optional: Record<string, never> = {}): string {
  if (!html.includes('data-jini-dropdown') || html.includes(SCRIPT_MARKER)) return html;
  const script = `<script ${SCRIPT_MARKER}>${MENU_DROPDOWN_SCRIPT}</script>`;
  const bodyClose = html.lastIndexOf('</body>');
  return bodyClose === -1 ? html + script : html.slice(0, bodyClose) + script + html.slice(bodyClose);
}
