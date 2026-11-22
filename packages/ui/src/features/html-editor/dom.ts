/** DOM-free compatibility view for the existing host attribute describer/predicate seam. */
export function sourceElementAttributeView(
  { tagName, attributes }: { tagName: string; attributes: Readonly<Record<string, string>> },
  _options: object = {},
): Element {
  return {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    attributes,
    getAttribute: (name: string) => attributes[name.toLowerCase()] ?? null,
    hasAttribute: (name: string) => Object.prototype.hasOwnProperty.call(attributes, name.toLowerCase()),
  } as unknown as Element;
}
