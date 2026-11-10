/**
 * A software WebAuthn authenticator for tests: real P-256 keys and signatures, "none" attestation.
 * It lets the tests drive @simplewebauthn/server's real verification without a browser.
 */
import crypto from "node:crypto";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

const b64 = (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64url");

// --- Minimal CBOR encoder (ints, byte strings, text strings, maps) ---
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
  throw new Error("too large");
}
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function cbor(v: Cbor): Buffer {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") { const s = Buffer.from(v, "utf8"); return Buffer.concat([head(3, s.length), s]); }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  const parts = [head(5, v.size)];
  for (const [k, val] of v) parts.push(cbor(k), cbor(val));
  return Buffer.concat(parts);
}

const UP = 0x01, UV = 0x04, AT = 0x40;

export class FakeAuthenticator {
  readonly credentialId = crypto.randomBytes(16);
  private readonly keys = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  counter = 0;
  userHandle: string | null = null;

  constructor(private readonly rpId: string, private readonly origin: string) {}

  private authData(flags: number, attested?: Buffer) {
    const rpIdHash = crypto.createHash("sha256").update(this.rpId).digest();
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    return Buffer.concat([rpIdHash, Buffer.from([flags]), counter, ...(attested ? [attested] : [])]);
  }

  private clientData(type: string, challenge: string, origin: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** Answers navigator.credentials.create(). `origin` can be overridden to simulate a look-alike site. */
  register(options: { challenge: string; user: { id: string } }, origin = this.origin): RegistrationResponseJSON {
    this.userHandle = options.user.id;
    const jwk = this.keys.publicKey.export({ format: "jwk" });
    const coseKey = new Map<Cbor, Cbor>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, Buffer.from(jwk.x!, "base64url")],
      [-3, Buffer.from(jwk.y!, "base64url")],
    ]);
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    const attested = Buffer.concat([Buffer.alloc(16), idLen, this.credentialId, cbor(coseKey)]);
    const attestationObject = cbor(new Map<Cbor, Cbor>([["fmt", "none"], ["attStmt", new Map()], ["authData", this.authData(UP | UV | AT, attested)]]));
    return {
      id: b64(this.credentialId),
      rawId: b64(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64(this.clientData("webauthn.create", options.challenge, origin)),
        attestationObject: b64(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** Answers navigator.credentials.get(). */
  authenticate(options: { challenge: string }, origin = this.origin): AuthenticationResponseJSON {
    this.counter += 1;
    const authenticatorData = this.authData(UP | UV);
    const clientDataJSON = this.clientData("webauthn.get", options.challenge, origin);
    const signed = Buffer.concat([authenticatorData, crypto.createHash("sha256").update(clientDataJSON).digest()]);
    const signature = crypto.sign("sha256", signed, this.keys.privateKey); // DER, as WebAuthn expects for ES256
    return {
      id: b64(this.credentialId),
      rawId: b64(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(authenticatorData),
        signature: b64(signature),
        userHandle: this.userHandle ?? undefined,
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
