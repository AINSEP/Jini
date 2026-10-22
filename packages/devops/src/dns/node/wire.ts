/**
 * @file A minimal DNS wire codec for exactly one exchange: an NS question sent to a PARENT zone's
 * nameserver, and the NS names in its answer or referral (authority) section. `node:dns` only
 * exposes the answer section, but a parent publishes a child's delegation as a referral in the
 * authority section — which is the registrar's truth that verification must read.
 */

export const DNS_TYPE_NS = 2;
const CLASS_IN = 1;
const HEADER_BYTES = 12;
const MAX_LABEL_BYTES = 63;
/** Bounds pointer chasing, so a hostile compression loop cannot spin forever. */
const MAX_POINTER_JUMPS = 32;
export const DNS_RCODE_NXDOMAIN = 3;

export interface NsReply {
  readonly id: number;
  readonly rcode: number;
  /** TC bit: the reply did not fit a UDP datagram and is incomplete. */
  readonly truncated: boolean;
  /** NS targets owned by the asked name, from the answer and authority sections (lowercase, deduplicated). */
  readonly nameservers: readonly string[];
}

/**
 * A non-recursive (RD=0) NS query for `name`.
 * @throws RangeError when a label exceeds 63 bytes (not a valid DNS name).
 * @complexity O(n) in the name length.
 */
export function encodeNsQuery(required: { readonly id: number; readonly name: string }, _optional = {}): Uint8Array {
  const encoder = new TextEncoder();
  const qname = required.name.split('.').filter(label => label !== '').flatMap(label => {
    const bytes = [...encoder.encode(label)];
    if (bytes.length > MAX_LABEL_BYTES) throw new RangeError(`The DNS label '${label}' is longer than ${MAX_LABEL_BYTES} bytes.`);
    return [bytes.length, ...bytes];
  });
  const id = required.id & 0xffff;
  return Uint8Array.from([id >> 8, id & 0xff, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, ...qname, 0, 0, DNS_TYPE_NS, 0, CLASS_IN]);
}

function u16(message: Uint8Array, offset: number): number {
  if (offset + 2 > message.length) throw new RangeError('The DNS message is truncated.');
  return ((message[offset] as number) << 8) | (message[offset + 1] as number);
}

function byteAt(message: Uint8Array, offset: number): number {
  if (offset >= message.length) throw new RangeError('The DNS message is truncated.');
  return message[offset] as number;
}

/** A possibly compressed name at `offset`, and the offset just past it in the record. */
function readName(message: Uint8Array, offset: number): { name: string; next: number } {
  const labels: string[] = [];
  let cursor = offset;
  let next: number | undefined;
  for (let jumps = 0; jumps <= MAX_POINTER_JUMPS;) {
    const length = byteAt(message, cursor);
    if (length === 0) return { name: labels.join('.').toLowerCase(), next: next ?? cursor + 1 };
    if (length >= 0xc0) {
      next ??= cursor + 2;
      cursor = u16(message, cursor) & 0x3fff;
      jumps += 1;
    } else if (length > MAX_LABEL_BYTES || cursor + 1 + length > message.length) {
      throw new RangeError('The DNS message has a malformed name.');
    } else {
      labels.push(new TextDecoder().decode(message.subarray(cursor + 1, cursor + 1 + length)));
      cursor += 1 + length;
    }
  }
  throw new RangeError('The DNS message has a name compression loop.');
}

/**
 * Decode a reply to {@link encodeNsQuery}: NS records owned by `name` in the answer and authority
 * sections. Other records (SOA, glue) are skipped.
 * @throws RangeError on a malformed or truncated message.
 * @complexity O(message length).
 */
export function decodeNsReply(required: { readonly message: Uint8Array; readonly name: string }, _optional = {}): NsReply {
  const { message } = required;
  const target = required.name.toLowerCase().replace(/\.$/, '');
  const flags = u16(message, 2);
  let offset = HEADER_BYTES;
  for (let question = u16(message, 4); question > 0; question -= 1) offset = readName(message, offset).next + 4;
  const nameservers: string[] = [];
  for (let record = u16(message, 6) + u16(message, 8); record > 0; record -= 1) {
    const owner = readName(message, offset);
    const rdata = owner.next + 10;
    const end = rdata + u16(message, owner.next + 8);
    if (end > message.length) throw new RangeError('The DNS message is truncated.');
    if (u16(message, owner.next) === DNS_TYPE_NS && owner.name === target) nameservers.push(readName(message, rdata).name);
    offset = end;
  }
  return { id: u16(message, 0), rcode: flags & 0xf, truncated: (flags & 0x0200) !== 0, nameservers: [...new Set(nameservers)] };
}
