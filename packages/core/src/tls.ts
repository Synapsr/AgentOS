/**
 * The computer's own TLS identity: a key and a self-signed certificate, made
 * once and kept in the data directory. Nobody vouches for it — clients trust
 * it because its fingerprint came to them in the pairing link, and they check
 * that fingerprint on every connection.
 *
 * The certificate is built here, with Node's own crypto: an X.509 v3
 * certificate is a few nested DER structures, and writing them out is less
 * to carry than a dependency or a call to `openssl`. What is written is read
 * back with `crypto.X509Certificate` before it is ever used.
 */
import { X509Certificate, createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface TlsIdentity {
  /** Private key, PEM. */
  key: string;
  /** Certificate, PEM. */
  cert: string;
  /** SHA-256 of the certificate (DER), lowercase hex: what clients pin. */
  fingerprint: string;
}

/** Long enough that nobody has to pair again because of a date. */
const VALID_YEARS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Loads the identity kept in a data directory, making it on first use — and
 * again when the one kept is unusable, which `log` is told: its fingerprint
 * changes, so paired devices must pair again.
 */
export function loadTlsIdentity(dir: string, log: (line: string) => void = () => {}): TlsIdentity {
  const keyPath = join(dir, "tls-key.pem");
  const certPath = join(dir, "tls-cert.pem");
  if (existsSync(keyPath) && existsSync(certPath)) {
    const stored = checked(readFileSync(keyPath, "utf8"), readFileSync(certPath, "utf8"));
    if (stored) return stored;
    log("The certificate in the data directory could not be used: a new one was made. Paired devices must pair again.");
  }
  const made = createTlsIdentity();
  writeFileSync(keyPath, made.key, { mode: 0o600 });
  writeFileSync(certPath, made.cert, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  chmodSync(certPath, 0o600);
  return made;
}

/** Makes a new P-256 key and a certificate for it, signed by itself. */
export function createTlsIdentity(now = Date.now()): TlsIdentity {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const name = sequence(set(sequence(oid(OID.commonName), utf8("AgentOS"))));
  const algorithm = sequence(oid(OID.ecdsaWithSha256));
  const tbs = sequence(
    tagged(0, der(0x02, Buffer.from([V3]))),
    integer(randomBytes(16)),
    algorithm,
    name, // issuer: itself
    sequence(time(now - DAY_MS), time(now + VALID_YEARS * 365 * DAY_MS)),
    name, // subject
    publicKey.export({ type: "spki", format: "der" }),
    tagged(
      3,
      sequence(
        extension(OID.basicConstraints, true, sequence()), // not a certificate authority
        extension(OID.keyUsage, true, bitString(Buffer.from([0x80]), 7)), // digital signature
        extension(OID.extendedKeyUsage, false, sequence(oid(OID.serverAuth))),
        extension(OID.subjectAltName, false, sequence(der(0x82, Buffer.from("agentos.internal")))),
      ),
    ),
  );
  const certificate = sequence(tbs, algorithm, bitString(sign("sha256", tbs, privateKey)));
  const key = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const cert = `-----BEGIN CERTIFICATE-----\n${certificate.toString("base64").replace(/(.{64})/g, "$1\n").trimEnd()}\n-----END CERTIFICATE-----\n`;
  const identity = checked(key, cert);
  if (!identity) throw new Error("The certificate that was just made does not hold together.");
  return identity;
}

/**
 * The identity, if the certificate parses, is in date, belongs to the key —
 * and says it is version 3 the way strict readers (Apple's) require: Node
 * is more forgiving than they are, and earlier versions of this file wrote
 * a version number they refuse.
 */
function checked(key: string, cert: string): TlsIdentity | null {
  try {
    const certificate = new X509Certificate(cert);
    const inDate = Date.parse(certificate.validFrom) <= Date.now() && Date.now() < Date.parse(certificate.validTo);
    if (!inDate || declaredVersion(certificate.raw) !== V3) return null;
    if (!certificate.checkPrivateKey(createPrivateKey(key)) || !certificate.verify(certificate.publicKey)) return null;
    return { key, cert, fingerprint: createHash("sha256").update(certificate.raw).digest("hex") };
  } catch {
    return null;
  }
}

// ───────────────────────────── DER, as much of it as a certificate needs ─────────────────────────────

/** How X.509 writes "version 3". */
const V3 = 2;

const OID = {
  ecdsaWithSha256: "2a8648ce3d040302", // 1.2.840.10045.4.3.2
  commonName: "550403", // 2.5.4.3
  keyUsage: "551d0f", // 2.5.29.15
  subjectAltName: "551d11", // 2.5.29.17
  basicConstraints: "551d13", // 2.5.29.19
  extendedKeyUsage: "551d25", // 2.5.29.37
  serverAuth: "2b06010505070301", // 1.3.6.1.5.5.7.3.1
};

/** One DER element: tag, length, contents. */
function der(tag: number, ...contents: Buffer[]): Buffer {
  const body = Buffer.concat(contents);
  const length = body.length < 0x80 ? [body.length] : body.length < 0x100 ? [0x81, body.length] : [0x82, body.length >> 8, body.length & 0xff];
  return Buffer.concat([Buffer.from([tag, ...length]), body]);
}

const sequence = (...items: Buffer[]): Buffer => der(0x30, ...items);
const set = (...items: Buffer[]): Buffer => der(0x31, ...items);
const oid = (hex: string): Buffer => der(0x06, Buffer.from(hex, "hex"));
const utf8 = (text: string): Buffer => der(0x0c, Buffer.from(text));
const octets = (bytes: Buffer): Buffer => der(0x04, bytes);
/** `[n] EXPLICIT`: a wrapper that says which optional field this is. */
const tagged = (n: number, inner: Buffer): Buffer => der(0xa0 | n, inner);
const bitString = (bytes: Buffer, unusedBits = 0): Buffer => der(0x03, Buffer.from([unusedBits]), bytes);

/** A serial number: positive (the top bit of the first byte clear) and never zero (its lowest bit set). */
function integer(bytes: Buffer): Buffer {
  const positive = Buffer.from(bytes);
  positive[0] = ((positive[0] ?? 0) & 0x7f) | 0x01;
  return der(0x02, positive);
}

/** A date: UTCTime up to 2049, GeneralizedTime from 2050, as X.509 asks. */
function time(ms: number): Buffer {
  const stamp = new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return new Date(ms).getUTCFullYear() < 2050 ? der(0x17, Buffer.from(`${stamp.slice(2)}Z`)) : der(0x18, Buffer.from(`${stamp}Z`));
}

function extension(id: string, critical: boolean, value: Buffer): Buffer {
  return sequence(oid(id), ...(critical ? [der(0x01, Buffer.from([0xff]))] : []), octets(value));
}

/** Where the contents of the DER element at `at` start and end. */
function contents(bytes: Buffer, at: number): { start: number; end: number } {
  const first = bytes[at + 1] ?? 0;
  const size = first < 0x80 ? 0 : first & 0x7f;
  const length = size === 0 ? first : bytes.readUIntBE(at + 2, size);
  const start = at + 2 + size;
  return { start, end: start + length };
}

/** The version field of a certificate (0 when absent: version 1), read from its DER as a strict reader does. Null when it is malformed. */
function declaredVersion(raw: Buffer): number | null {
  const tbs = contents(raw, contents(raw, 0).start).start;
  if (raw[tbs] !== 0xa0) return 0;
  const field = contents(raw, tbs).start;
  const value = contents(raw, field);
  return raw[field] === 0x02 && value.end - value.start === 1 ? (raw[value.start] ?? null) : null;
}
