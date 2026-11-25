/** A tiny `.mov`/`.m4v` byte fixture: a self-consistent ftyp box naming `brand`, then a stub `mdat`. */
export function isoBmffVideoBytes(brand: string): Buffer {
  const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from(`ftyp${brand}`), Buffer.alloc(4), Buffer.from(brand)]);
  return Buffer.concat([ftyp, Buffer.from([0, 0, 0, 8]), Buffer.from("mdat")]);
}
