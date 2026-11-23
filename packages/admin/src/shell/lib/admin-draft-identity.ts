// Host session identity for CMS draft storage. Editors capture it before a 401 unmounts them.
let principalId: string | null = null;
export function setAdminDraftIdentity({ id }: { id: string | null }, _options = {}): void { principalId = id; }
export function getAdminDraftIdentity(_args = {}, _options = {}): string | null { return principalId; }
