export function resolvePublicOrigin({ configured: raw, derivedPublicOrigin, invalidConfiguredOrigin }: {
  configured: string | undefined;
  derivedPublicOrigin: string | undefined;
  invalidConfiguredOrigin(input: { configured: string; reason: 'url' | 'protocol' }): undefined;
}, _optional = {}): string | undefined {
  const configured = raw?.trim();
  let origin: string | undefined;
  if (configured) {
    let url: URL | undefined;
    try {
      url = new URL(configured);
    } catch {
      url = undefined;
    }
    if (url === undefined) origin = invalidConfiguredOrigin({ configured, reason: 'url' });
    else if (url.protocol !== 'http:' && url.protocol !== 'https:') origin = invalidConfiguredOrigin({ configured, reason: 'protocol' });
    else origin = url.origin;
  }
  origin ??= derivedPublicOrigin || undefined;
  return origin;
}
