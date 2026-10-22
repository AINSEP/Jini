export function canMountPlayground({ permissions }: { permissions: readonly string[] }, _optional = {}) { return permissions.includes('playground.read'); }
