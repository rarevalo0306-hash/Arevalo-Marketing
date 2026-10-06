import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { bi } from "@/lib/i18n";

function key(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) {
    throw bi(
      "APP_SECRET falta o es muy corta (mínimo 32 caracteres). Revisa tu archivo .env.",
      "APP_SECRET is missing or too short (at least 32 characters). Check your .env file.",
    );
  }
  return createHash("sha256").update(secret).digest();
}

/** Cifra un objeto con AES-256-GCM. Formato: iv.tag.datos (base64url). */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map((b) => b.toString("base64url")).join(".");
}

export function decryptJson<T = Record<string, string>>(payload: string): T {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as T;
}
