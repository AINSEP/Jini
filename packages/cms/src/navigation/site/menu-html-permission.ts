/**
 * The permission a menu write needs on top of the menu permission when it carries author-written HTML
 * (menu HTML mode, owner 2026-10-08). The same one HTML-mode forms bind (the host's forms module):
 * raw HTML is one trust boundary across Pages, Forms and Menus — admins and owners.
 */
export const MENU_RAW_HTML_PERMISSION = "pages.edit_html";
