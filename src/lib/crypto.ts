import { createCipheriv, createDecipheriv } from "crypto";

import { createHash } from "crypto";

export const SEED = process.env.NEXT_PUBLIC_SEED || "8l.wtf";

export function encrypt(data: string, token: string) {
  const key = Buffer.from(token, "hex");

  const hash = createHash("sha256").update(token).digest();
  const iv = hash.subarray(0, 16);

  const cipher = createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");

  return `${iv.toString("hex")}:${encrypted}`;
}

export function generateDeterministicIV(token: string): Buffer {
  return createHash("sha256").update(token).digest().subarray(0, 16);
}

export function decrypt(encryptedData: string, token: string) {
  const key = Buffer.from(token, "hex");

  const [ivHex, encryptedHex] = encryptedData.split(":");
  const iv = Buffer.from(ivHex, "hex");

  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
