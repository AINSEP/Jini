/** Structural slice of the host's TipTap `NodeViewProps`: only the attr writer the replace uses. */
interface MediaImageNodeViewSlice {
  updateAttributes: (attributes: Record<string, unknown>) => void;
}

/** Bind this screen's copy to the current locale. `translate` is the host's locale-aware dictionary lookup. */
export function createMediaImageTranslator(
  { locale, translate }: { locale: string; translate: (input: { locale: string; key: string }) => string },
  _options = {},
) {
  return ({ key }: { key: string }, _options = {}): string => translate({ locale, key });
}

/** Replace the image reference and close its picker. */
export function createMediaImageReplace({ props, setPicking }: { props: MediaImageNodeViewSlice; setPicking: (value: boolean) => void }, _options = {}) {
  return (item: { id: string; alt: string; title: string }) => {
    props.updateAttributes({ assetId: item.id, transformName: "public", alt: item.alt || item.title, src: null, title: null });
    setPicking(false);
  };
}
