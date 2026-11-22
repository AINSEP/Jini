import { NAV_MENU_CONTENT_TYPE } from "../../navigation/types.js";

/** Content types a collection list must never resolve against, even if asked to by config —
 * these are platform plumbing, not user content (D8). `NAV_MENU_CONTENT_TYPE` comes from
 * the `@jini-ai/cms` navigation type/vocabulary leaf, without loading menu services. */
export const SYSTEM_CONTENT_TYPES: readonly string[] = ["widget", "widget_area", NAV_MENU_CONTENT_TYPE];
