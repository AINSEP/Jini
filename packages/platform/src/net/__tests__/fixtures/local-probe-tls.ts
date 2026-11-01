/** Public P-256 certificate templates retain the non-CA/SAN/issuer cases used by the TLS tests.
 * Keys and signatures are regenerated per process with Node crypto: no committed private material,
 * OpenSSL executable, or external certificate generator is needed, including on Windows.
 */
import { generateKeyPairSync, sign, X509Certificate, type KeyObject } from 'node:crypto';

const ROOT_TEMPLATE = `-----BEGIN CERTIFICATE-----
MIIBVzCB/qADAgECAgkAyxkTLNq3PWUwCgYIKoZIzj0EAwIwHjEcMBoGA1UEAwwT
TG9jYWwgcHJvYmUgdGVzdCBDQTAgFw0yNjEwMzEyMzAwNTRaGA8yMTI2MTAwNzIz
MDA1NFowHjEcMBoGA1UEAwwTTG9jYWwgcHJvYmUgdGVzdCBDQTBZMBMGByqGSM49
AgEGCCqGSM49AwEHA0IABEnvQKDpm13DzvwOREEM6LpL64XuFvudvUC2w1Lr4s50
k8+4rs7waIUWht7sVuBxJhHUgfuZhbOEu1qBl6PK/jGjIzAhMA8GA1UdEwEB/wQF
MAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMCA0gAMEUCID11433NXZzf
tudNksWZBQDTymWunASZyjo/+4fubz8OAiEAj1EX0nmIhgQ18SJK/Yj5sBxb+Tu8
mYvdxMz/qlWKqr0=
-----END CERTIFICATE-----`;
const LEAF_TEMPLATE = `-----BEGIN CERTIFICATE-----
MIIBbzCCARSgAwIBAgIBATAKBggqhkjOPQQDAjAeMRwwGgYDVQQDDBNMb2NhbCBw
cm9iZSB0ZXN0IENBMCAXDTI2MTAzMTIzMDA1NFoYDzIxMjYxMDA3MjMwMDU0WjAU
MRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAR6
fcbeZrS73drt0uMt9RDF6nZbBYaILenoJug9uULHLymf9YgHk08HIl1dePSMgOpB
rdmtoiQJyuyG130Q2atxo0swSTAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIH
gDATBgNVHSUEDDAKBggrBgEFBQcDATAUBgNVHREEDTALgglsb2NhbGhvc3QwCgYI
KoZIzj0EAwIDSQAwRgIhAKb75Px1a2N4aMT2vJ2kxsQKBe9JffcSd6KbC045Usj8
AiEAnTJ8XtYSw6agfHaikH4U4tEW1evkp5DJ2CNmItKBqiM=
-----END CERTIFICATE-----`;
const OTHER_TEMPLATE = `-----BEGIN CERTIFICATE-----
MIIBbzCCARSgAwIBAgIBAjAKBggqhkjOPQQDAjAeMRwwGgYDVQQDDBNMb2NhbCBw
cm9iZSB0ZXN0IENBMCAXDTI2MTAzMTIzMDA1NFoYDzIxMjYxMDA3MjMwMDU0WjAU
MRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAS7
y72dQXWcNY+qkmKP9UDTP1V+3ENnsI4fsxA2vzuNqg5Uf0gkbrEfIIzo/7bsWL8K
UekmhtMYXr/AC92HtFXoo0swSTAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIH
gDATBgNVHSUEDDAKBggrBgEFBQcDATAUBgNVHREEDTALgglsb2NhbGhvc3QwCgYI
KoZIzj0EAwIDSQAwRgIhAO4asBl662qwKkcKANgmRWTcPMvuLIShhAgof1gDx0HX
AiEAzp3x7mjqoh4inzSM2tCTYLdIqE34HEJEd3iwa98lJiY=
-----END CERTIFICATE-----`;
const WRONGHOST_TEMPLATE = `-----BEGIN CERTIFICATE-----
MIIBdTCCARygAwIBAgIBAzAKBggqhkjOPQQDAjAeMRwwGgYDVQQDDBNMb2NhbCBw
cm9iZSB0ZXN0IENBMCAXDTI2MTAzMTIzMDA1NFoYDzIxMjYxMDA3MjMwMDU0WjAY
MRYwFAYDVQQDDA13cm9uZy5leGFtcGxlMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcD
QgAEDqghNaPIffplj7KdVuwV/lk2p2tDsgaT05TZ9MlB0dkuM2C9wXy8nr5lxO1N
vFy0KX42LQ86qn/RTPe1nCl39aNPME0wDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8E
BAMCB4AwEwYDVR0lBAwwCgYIKwYBBQUHAwEwGAYDVR0RBBEwD4INd3JvbmcuZXhh
bXBsZTAKBggqhkjOPQQDAgNHADBEAiAgfBqTMJGNmQBBNjDhaiwcPiJEYH/2Wgt9
2KTCQvRmNwIgOH0INY8Z3x+aeqeK9DprCdL+XDQpdu5H5JY5EJN4vcs=
-----END CERTIFICATE-----`;
const SELF_TEMPLATE = `-----BEGIN CERTIFICATE-----
MIIBZDCCAQqgAwIBAgIBBDAKBggqhkjOPQQDAjAUMRIwEAYDVQQDDAlsb2NhbGhv
c3QwIBcNMjYxMDMxMjMwMDU0WhgPMjEyNjEwMDcyMzAwNTRaMBQxEjAQBgNVBAMM
CWxvY2FsaG9zdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABNH7V7wvSAMJYMzq
dWs+BeIpodjU17Gnu+qbyVculHFVVj8Mc1hYU1sa5BuB9xRABEL70+upILQhTU2V
Z05en/KjSzBJMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQM
MAoGCCsGAQUFBwMBMBQGA1UdEQQNMAuCCWxvY2FsaG9zdDAKBggqhkjOPQQDAgNI
ADBFAiADSiAicpJBRvNdrss97qXAxAVCGbaDGLGEnULpC/a87gIhAKsOg0TEpSlr
bQUHwHAxZPOXrgyhDu+TJVawgTUmpEkG
-----END CERTIFICATE-----`;

/** Read one trusted fixture's DER value bounds; this is not an untrusted-certificate parser. */
function valueBounds(bytes: Buffer, offset: number): { start: number; end: number } {
  const first = bytes[offset + 1]!;
  const width = first < 128 ? 0 : first & 0x7f;
  const length = width === 0 ? first : bytes.readUIntBE(offset + 2, width);
  const start = offset + 2 + width;
  return { start, end: start + length };
}

/** Re-encode the envelope/bit-string length after an ECDSA signature changes size. */
function der(tag: number, content: Buffer): Buffer {
  const length = content.length;
  const size = length < 128 ? [length] : length < 256 ? [0x81, length] : [0x82, length >> 8, length & 0xff];
  return Buffer.concat([Buffer.from([tag, ...size]), content]);
}

/** Replace only a template's fixed-size P-256 public key, then sign its unchanged X.509 claims.
 * O(certificate bytes); ephemeral private keys exist only in the test process.
 */
function rekeyCertificate({ template }: { template: string }, { issuerKey }: { issuerKey?: KeyObject } = {}) {
  const original = new X509Certificate(template);
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const raw = original.raw;
  const envelope = valueBounds(raw, 0);
  const tbs = valueBounds(raw, envelope.start);
  const body = Buffer.from(raw.subarray(envelope.start, tbs.end));
  const oldPublicKey = original.publicKey.export({ format: 'der', type: 'spki' });
  pair.publicKey.export({ format: 'der', type: 'spki' }).copy(body, body.indexOf(oldPublicKey));
  const algorithm = raw.subarray(tbs.end, valueBounds(raw, tbs.end).end);
  const signature = sign('sha256', body, issuerKey ?? pair.privateKey);
  const cert = new X509Certificate(der(0x30, Buffer.concat([body, algorithm, der(0x03, Buffer.concat([Buffer.of(0), signature]))])));
  return { cert: cert.toString(), key: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), privateKey: pair.privateKey };
}

const root = rekeyCertificate({ template: ROOT_TEMPLATE });
export const ROOT_CERT = root.cert;
export const { cert: LEAF_CERT, key: LEAF_KEY } = rekeyCertificate({ template: LEAF_TEMPLATE }, { issuerKey: root.privateKey });
export const { cert: OTHER_CERT, key: OTHER_KEY } = rekeyCertificate({ template: OTHER_TEMPLATE }, { issuerKey: root.privateKey });
export const { cert: WRONGHOST_CERT, key: WRONGHOST_KEY } = rekeyCertificate({ template: WRONGHOST_TEMPLATE }, { issuerKey: root.privateKey });
export const { cert: SELF_CERT, key: SELF_KEY } = rekeyCertificate({ template: SELF_TEMPLATE });
