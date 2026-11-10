/** The computer's certificate: built by hand, so checked every way Node can check it — and by stricter readers than Node. */
import { execFileSync, spawnSync } from "node:child_process";
import { X509Certificate, createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { connect } from "node:tls";
import { describe, expect, it } from "vitest";
import { type TlsIdentity, createTlsIdentity, loadTlsIdentity } from "../src/tls.js";
import { tempHome } from "./harness.js";

const has = (command: string): boolean => spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;

/**
 * The same certificate as AgentOS 0.1.0 wrote it before this was fixed:
 * version field `INTEGER 3` instead of 2, properly signed all the same —
 * which Node accepts and Apple does not.
 */
function asFirstWritten(identity: TlsIdentity): string {
  const raw = new X509Certificate(identity.cert).raw;
  // Certificate = SEQUENCE { tbs, algorithm, signature }; both SEQUENCEs here have two-byte lengths.
  expect([raw[0], raw[1], raw[4], raw[5]]).toEqual([0x30, 0x82, 0x30, 0x82]);
  const tbs = Buffer.from(raw.subarray(4, 8 + raw.readUInt16BE(6)));
  // [0] { INTEGER 2 } starts the tbs: a0 03 02 01 02.
  expect([...tbs.subarray(4, 9)]).toEqual([0xa0, 0x03, 0x02, 0x01, 0x02]);
  tbs[8] = 3;
  const algorithm = raw.subarray(4 + tbs.length, 4 + tbs.length + 12);
  const signature = sign("sha256", tbs, createPrivateKey(identity.key));
  const der = (tag: number, body: Buffer): Buffer =>
    Buffer.concat([Buffer.from(body.length < 0x80 ? [tag, body.length] : [tag, 0x82, body.length >> 8, body.length & 0xff]), body]);
  const certificate = der(0x30, Buffer.concat([tbs, algorithm, der(0x03, Buffer.concat([Buffer.from([0]), signature]))]));
  return `-----BEGIN CERTIFICATE-----\n${certificate.toString("base64").replace(/(.{64})/g, "$1\n").trimEnd()}\n-----END CERTIFICATE-----\n`;
}

describe("the computer's certificate", () => {
  it("is a well-formed X.509 certificate, signed by its own key, for ten years", () => {
    const identity = createTlsIdentity();
    const certificate = new X509Certificate(identity.cert);
    expect(certificate.subject).toBe("CN=AgentOS");
    expect(certificate.issuer).toBe("CN=AgentOS");
    expect(certificate.verify(certificate.publicKey)).toBe(true);
    expect(certificate.checkPrivateKey(createPrivateKey(identity.key))).toBe(true);
    expect(certificate.ca).toBe(false);
    expect(certificate.subjectAltName).toBe("DNS:agentos.internal");
    expect(certificate.keyUsage).toEqual(["1.3.6.1.5.5.7.3.1"]);
    expect(certificate.publicKey.asymmetricKeyDetails).toMatchObject({ namedCurve: "prime256v1" });
    const years = (Date.parse(certificate.validTo) - Date.parse(certificate.validFrom)) / (365 * 24 * 3600 * 1000);
    expect(years).toBeGreaterThan(9.9);
    expect(Date.parse(certificate.validFrom)).toBeLessThan(Date.now());
    // The fingerprint clients pin is the SHA-256 of the certificate as it travels.
    expect(identity.fingerprint).toBe(createHash("sha256").update(certificate.raw).digest("hex"));
    expect(identity.fingerprint).toBe(certificate.fingerprint256.replaceAll(":", "").toLowerCase());
    expect(identity.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is never the same twice", () => {
    const [first, second] = [createTlsIdentity(), createTlsIdentity()];
    expect(first.fingerprint).not.toBe(second.fingerprint);
    expect(new X509Certificate(first.cert).serialNumber).not.toBe(new X509Certificate(second.cert).serialNumber);
  });

  it("carries a real TLS handshake, and the client sees the fingerprint it was given", async () => {
    const identity = createTlsIdentity();
    const server = createServer({ key: identity.key, cert: identity.cert }, (_request, response) => response.end("hello over TLS"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const seen = await new Promise<{ fingerprint: string; protocol: string | null; authorized: boolean }>((resolve, reject) => {
      // Nobody vouches for this certificate: the client checks the fingerprint itself, as a paired device does.
      const socket = connect({ host: "127.0.0.1", port, rejectUnauthorized: false }, () => {
        const fingerprint = createHash("sha256").update(socket.getPeerCertificate().raw).digest("hex");
        resolve({ fingerprint, protocol: socket.getProtocol(), authorized: socket.authorized });
        socket.end();
      });
      socket.on("error", reject);
    });
    expect(seen.fingerprint).toBe(identity.fingerprint);
    expect(seen.protocol).toMatch(/^TLSv1\.[23]$/);
    expect(seen.authorized).toBe(false);

    // And with that certificate as the only one trusted, the handshake verifies end to end.
    const body = await new Promise<string>((resolve, reject) => {
      const socket = connect({ host: "127.0.0.1", port, ca: identity.cert, servername: "agentos.internal" }, () => {
        socket.write("GET / HTTP/1.0\r\n\r\n");
      });
      let text = "";
      socket.on("data", (chunk) => (text += chunk));
      socket.on("end", () => resolve(text));
      socket.on("error", reject);
    });
    expect(body).toContain("hello over TLS");
    await new Promise((resolve) => server.close(resolve));
  });

  it("is made once and kept, readable by its owner only", () => {
    const home = tempHome();
    const first = loadTlsIdentity(home);
    expect(loadTlsIdentity(home)).toEqual(first);
    expect(statSync(join(home, "tls-key.pem")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(home, "tls-key.pem"), "utf8")).toContain("PRIVATE KEY");
  });

  it.skipIf(!has("openssl"))("is version 3 to OpenSSL's own reader", () => {
    const home = tempHome();
    const path = join(home, "cert.pem");
    writeFileSync(path, createTlsIdentity().cert);
    const text = execFileSync("openssl", ["x509", "-in", path, "-noout", "-text"], { encoding: "utf8" });
    expect(text).toContain("Version: 3 (0x2)");
    // And what the defect looked like there.
    writeFileSync(path, asFirstWritten(createTlsIdentity()));
    expect(execFileSync("openssl", ["x509", "-in", path, "-noout", "-text"], { encoding: "utf8" })).toContain("Version: Unknown (3)");
  });

  it.skipIf(process.platform !== "darwin" || !has("swift"))("is readable by Apple's Security framework, which an iPhone uses", () => {
    const home = tempHome();
    const script = join(home, "read.swift");
    writeFileSync(
      script,
      'import Foundation\nimport Security\nlet data = FileManager.default.contents(atPath: CommandLine.arguments[1]) ?? Data()\nprint(SecCertificateCreateWithData(nil, data as CFData) == nil ? "unreadable" : "readable")\n',
    );
    const read = (pem: string): string => {
      const path = join(home, "cert.der");
      writeFileSync(path, new X509Certificate(pem).raw);
      return execFileSync("swift", [script, path], { encoding: "utf8" }).trim();
    };
    expect(read(createTlsIdentity().cert)).toBe("readable");
    expect(read(asFirstWritten(createTlsIdentity()))).toBe("unreadable");
  }, 120_000);

  it("replaces a certificate kept with the version Apple refuses, and says so", () => {
    const home = tempHome();
    const kept = createTlsIdentity();
    writeFileSync(join(home, "tls-key.pem"), kept.key);
    writeFileSync(join(home, "tls-cert.pem"), asFirstWritten(kept));
    // Node itself has nothing against it: only its version gives it away.
    expect(new X509Certificate(asFirstWritten(kept)).verify(new X509Certificate(kept.cert).publicKey)).toBe(true);

    const lines: string[] = [];
    const replaced = loadTlsIdentity(home, (line) => lines.push(line));
    expect(replaced.fingerprint).not.toBe(createHash("sha256").update(new X509Certificate(asFirstWritten(kept)).raw).digest("hex"));
    expect(readFileSync(join(home, "tls-cert.pem"), "utf8")).toBe(replaced.cert);
    expect(lines).toEqual(["The certificate in the data directory could not be used: a new one was made. Paired devices must pair again."]);
    // Once replaced, it is kept, quietly.
    expect(loadTlsIdentity(home, (line) => lines.push(line))).toEqual(replaced);
    expect(lines).toHaveLength(1);
  });

  it("is made again when what is kept cannot be used", () => {
    const home = tempHome();
    const first = loadTlsIdentity(home);
    writeFileSync(join(home, "tls-cert.pem"), createTlsIdentity().cert);
    const second = loadTlsIdentity(home);
    // A certificate that does not belong to the key is no identity.
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(new X509Certificate(second.cert).checkPrivateKey(createPrivateKey(second.key))).toBe(true);
  });
});
