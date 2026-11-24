/** Bind this screen's copy to the current locale. `translate` is the host's dictionary lookup. */
export function createPostsTranslator(
  { locale, translate }: { locale: string; translate: (required: { locale: string; key: string }) => string },
  _options = {},
) {
  return (key: string): string => translate({ locale, key });
}
