// ruleid: no-as-any
const unsafe = value as any;
// ruleid: no-as-any
const twice = value as unknown as any;
// ok: no-as-any
const unknownValue = value as unknown;
// ok: no-as-any
const typed = value as Request;
// ok: no-as-any
const words = 'as any';
