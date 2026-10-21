import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt with the OWASP-recommended cost (N=2^17, r=8, p=1).
// Stored format: scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const MAX_MEM = 256 * 1024 * 1024;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LEN, { N: n, r, p, maxmem: MAX_MEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Used when an email is unknown, so a wrong email takes as long as a wrong password
// and response time does not reveal which accounts exist.
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}
