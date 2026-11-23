import { useEffect } from "react";

/** The shell and content screens follow core.language already; the document must agree so
 * assistive technology reads the right language and Arabic/Persian/Urdu use RTL layout. */
export function useAdminDocumentLocale(
  { locale }: { locale: string },
  { root = document.documentElement } = {},
): void {
  useEffect(() => {
    root.lang = locale;
    // Same RTL languages as Jini's I18nProvider; accept regional tags from stored settings too.
    root.dir = ["ar", "fa", "he", "ur"].includes(locale.toLowerCase().split("-")[0]!) ? "rtl" : "ltr";
  }, [locale, root]);
}
