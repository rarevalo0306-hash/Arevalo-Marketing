import { afterEach, describe, expect, it, vi } from "vitest";
import {
  amzDate,
  deleteObject,
  encodePath,
  headObject,
  isLibraryKey,
  keyFromPublicUrl,
  newKey,
  presignPut,
  presignUrl,
  publicUrl,
  putObject,
  r2Enabled,
  sha256Hex,
  signHeaders,
  signingKey,
  type SigV4Creds,
} from "@/lib/r2";

// Ejemplos oficiales de la documentación de AWS S3 («Signature Calculations…», Signature Version 4):
// bucket examplebucket, llave AKIAIOSFODNN7EXAMPLE y su clave secreta de ejemplo, 24 de mayo de 2013, us-east-1.
const AWS: SigV4Creds = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", service: "s3" };
const WHEN = new Date("2013-05-24T00:00:00Z");
const HOST = "examplebucket.s3.amazonaws.com";
const sigOf = (h: Record<string, string>) => /Signature=([a-f0-9]{64})/.exec(h.authorization)?.[1];

describe("firma AWS Signature V4", () => {
  it("fecha y llave del día", () => {
    expect(amzDate(WHEN)).toBe("20130524T000000Z");
    // Ejemplo de la documentación de IAM («Examples of how to derive a signing key»).
    expect(signingKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20120215", "us-east-1", "iam").toString("hex")).toBe(
      "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d",
    );
  });

  it("GET de un objeto firmado en las cabeceras (con Range)", () => {
    const h = signHeaders({ method: "GET", host: HOST, path: "/test.txt", headers: { Range: "bytes=0-9" }, payloadHash: sha256Hex(""), when: WHEN }, AWS);
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(h["x-amz-date"]).toBe("20130524T000000Z");
  });

  it("PUT de un objeto con cuerpo firmado (y un $ en el nombre)", () => {
    const body = Buffer.from("Welcome to Amazon S3.");
    expect(sha256Hex(body)).toBe("44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");
    const h = signHeaders(
      {
        method: "PUT",
        host: HOST,
        path: encodePath("/test$file.text"),
        headers: { Date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
        payloadHash: sha256Hex(body),
        when: WHEN,
      },
      AWS,
    );
    expect(sigOf(h)).toBe("98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
    expect(h.authorization).toContain("SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class");
  });

  it("GET con parámetros en la dirección (subrecurso y lista)", () => {
    const lifecycle = signHeaders({ method: "GET", host: HOST, path: "/", query: [["lifecycle", ""]], payloadHash: sha256Hex(""), when: WHEN }, AWS);
    expect(sigOf(lifecycle)).toBe("fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543");
    const list = signHeaders(
      { method: "GET", host: HOST, path: "/", query: [["prefix", "J"], ["max-keys", "2"]], payloadHash: sha256Hex(""), when: WHEN },
      AWS,
    );
    expect(sigOf(list)).toBe("34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });

  it("dirección prefirmada (ejemplo oficial: GET de test.txt por 24 horas)", () => {
    const url = presignUrl({ method: "GET", host: HOST, path: "/test.txt", when: WHEN, expiresSec: 86400 }, AWS);
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });
});

describe("Cloudflare R2", () => {
  const env = { R2_ACCOUNT_ID: "acc123", R2_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE", R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", R2_BUCKET: "arevalo-media", R2_PUBLIC_URL: "https://pub-abc.r2.dev/" };
  const setEnv = (on: boolean) => {
    for (const [k, v] of Object.entries(env)) {
      if (on) vi.stubEnv(k, v);
      else vi.stubEnv(k, "");
    }
  };
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sin las 5 variables queda apagado, con un error claro", () => {
    setEnv(false);
    expect(r2Enabled()).toBe(false);
    expect(() => presignPut("library/b/2026-10/x.jpg", "image/jpeg")).toThrow(/Cloudflare R2/);
    setEnv(true);
    vi.stubEnv("R2_PUBLIC_URL", "pub-abc.r2.dev");
    expect(r2Enabled()).toBe(false);
  });

  it("dirección prefirmada para subir: región auto, tipo de archivo firmado", () => {
    setEnv(true);
    const key = "library/biz1/2026-10/0123456789abcdef01234567.jpg";
    const when = new Date("2026-10-08T12:00:00Z");
    const url = new URL(presignPut(key, "image/jpeg", 900, when));
    expect(url.host).toBe("acc123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe(`/arevalo-media/${key}`);
    expect(url.searchParams.get("X-Amz-Credential")).toBe("AKIAIOSFODNN7EXAMPLE/20261008/auto/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    // Lo mismo calculado a mano con la función general (misma firma) y distinta si cambia el tipo.
    const same = presignUrl(
      { method: "PUT", host: "acc123.r2.cloudflarestorage.com", path: `/arevalo-media/${key}`, headers: { "Content-Type": "image/jpeg" }, when, expiresSec: 900 },
      { ...AWS, region: "auto" },
    );
    expect(url.toString()).toBe(same);
    expect(new URL(presignPut(key, "image/png", 900, when)).searchParams.get("X-Amz-Signature")).not.toBe(url.searchParams.get("X-Amz-Signature"));
    expect(publicUrl(key)).toBe(`https://pub-abc.r2.dev/${key}`);
    expect(keyFromPublicUrl(`https://pub-abc.r2.dev/${key}`)).toBe(key);
    expect(keyFromPublicUrl(`https://otro.r2.dev/${key}`)).toBeNull();
  });

  it("PUT, HEAD y DELETE firmados en las cabeceras", async () => {
    setEnv(true);
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (init.method === "HEAD") return url.endsWith("missing.jpg") ? new Response(null, { status: 404 }) : new Response(null, { status: 200, headers: { "content-length": "1234", "content-type": "image/jpeg" } });
        return init.method === "DELETE" ? new Response(null, { status: 204 }) : new Response("", { status: 200 });
      }),
    );
    const key = "library/biz1/2026-10/0123456789abcdef01234567.jpg";
    const url = await putObject(key, Buffer.from("hola"), "image/jpeg");
    expect(url).toBe(`https://pub-abc.r2.dev/${key}`);
    const put = calls[0];
    expect(put.url).toBe(`https://acc123.r2.cloudflarestorage.com/arevalo-media/${key}`);
    const h = put.init.headers as Record<string, string>;
    expect(h["x-amz-content-sha256"]).toBe(sha256Hex("hola"));
    expect(h.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/);
    expect(await headObject(key)).toEqual({ size: 1234, contentType: "image/jpeg" });
    expect(await headObject("library/biz1/2026-10/missing.jpg")).toBeNull();
    await deleteObject(key);
    expect(calls.map((c) => c.init.method)).toEqual(["PUT", "HEAD", "HEAD", "DELETE"]);
  });

  it("si R2 rechaza la subida, el error se entiende", async () => {
    setEnv(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("AccessDenied", { status: 403 })));
    await expect(putObject("library/biz1/2026-10/0123456789abcdef01234567.jpg", Buffer.from("x"), "image/jpeg")).rejects.toThrow(/R2 \(403\)/);
  });

  it("llaves: library/<negocio>/<aaaa-mm>/<24 hex>.<ext>, solo del negocio", () => {
    const k = newKey("cmuvspllw0000l6047ocei6sx", "mp4", new Date("2026-03-05T10:00:00Z"));
    expect(k).toMatch(/^library\/cmuvspllw0000l6047ocei6sx\/2026-03\/[a-f0-9]{24}\.mp4$/);
    expect(isLibraryKey(k, "cmuvspllw0000l6047ocei6sx", ["mp4", "jpg"])).toBe(true);
    expect(isLibraryKey(k, "otro", ["mp4"])).toBe(false);
    expect(isLibraryKey(k, "cmuvspllw0000l6047ocei6sx", ["jpg"])).toBe(false);
    expect(isLibraryKey("library/cmuvspllw0000l6047ocei6sx/2026-03/../x.mp4", "cmuvspllw0000l6047ocei6sx", ["mp4"])).toBe(false);
  });
});
