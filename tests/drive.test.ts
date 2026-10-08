import { createVerify, generateKeyPairSync } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveApiError, listMedia, thumbnailAt, type DriveFile } from "@/lib/drive";
import { buildJwt, clearTokenCache, DRIVE_SCOPE, getAccessToken, readServiceAccount } from "@/lib/google-sa";
import { driveFolderId } from "@/lib/library-shape";
import { parseAnalysis, pickBatch, planSync, syncMessage, type KnownItem, type SyncResult } from "@/lib/library-sync";
import { translator } from "@/lib/i18n";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const EMAIL = "fotos-app@mi-proyecto.iam.gserviceaccount.com";
const KEY_JSON = JSON.stringify({ type: "service_account", project_id: "mi-proyecto", client_email: EMAIL, private_key: privateKey });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("cuenta de servicio: JWT", () => {
  it("arma y firma el JWT con RS256 y la firma se valida con la llave pública", () => {
    const sa = readServiceAccount(KEY_JSON)!;
    const jwt = buildJwt(sa, DRIVE_SCOPE, 1_700_000_000);
    const [h, c, sig] = jwt.split(".");
    expect(decode(h)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(c)).toEqual({ iss: EMAIL, scope: DRIVE_SCOPE, aud: "https://oauth2.googleapis.com/token", iat: 1_700_000_000, exp: 1_700_003_600 });
    const ok = createVerify("RSA-SHA256").update(`${h}.${c}`).end().verify(publicKey, Buffer.from(sig, "base64url"));
    expect(ok).toBe(true);
    // Si se cambia el contenido, la firma ya no vale.
    const forged = Buffer.from(JSON.stringify({ ...decode(c), iss: "otro@x.com" })).toString("base64url");
    expect(createVerify("RSA-SHA256").update(`${h}.${forged}`).end().verify(publicKey, Buffer.from(sig, "base64url"))).toBe(false);
  });

  it("lee la llave pegada tal cual, en base64 o con los saltos escapados dos veces; rechaza lo que no sirve", () => {
    expect(readServiceAccount(KEY_JSON)?.client_email).toBe(EMAIL);
    expect(readServiceAccount(Buffer.from(KEY_JSON).toString("base64"))?.private_key).toBe(privateKey);
    const doubled = JSON.stringify({ client_email: EMAIL, private_key: privateKey.replace(/\n/g, "\\n") });
    expect(readServiceAccount(doubled)?.private_key).toBe(privateKey);
    expect(readServiceAccount("")).toBeNull();
    expect(readServiceAccount("{nope")).toBeNull();
    expect(readServiceAccount(JSON.stringify({ client_email: EMAIL }))).toBeNull();
  });

  it("una llave dañada da un error simple", () => {
    expect(() => buildJwt({ client_email: EMAIL, private_key: "-----BEGIN PRIVATE KEY-----\nxx\n-----END PRIVATE KEY-----" }, DRIVE_SCOPE)).toThrow(/no es válida/);
  });
});

describe("cuenta de servicio: permiso de acceso", () => {
  beforeEach(() => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = KEY_JSON;
    clearTokenCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  });

  it("cambia el JWT por un permiso y lo guarda hasta que vence", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://oauth2.googleapis.com/token");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      expect(body.get("assertion")!.split(".")).toHaveLength(3);
      return json({ access_token: "ya29.token", expires_in: 3600 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await getAccessToken()).toBe("ya29.token");
    expect(await getAccessToken()).toBe("ya29.token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sin la variable configurada lo dice en palabras simples", async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    await expect(getAccessToken()).rejects.toThrow(/GOOGLE_SERVICE_ACCOUNT_JSON/);
  });

  it("si Google rechaza la llave, pide una nueva", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "invalid_grant" }, 400)));
    await expect(getAccessToken()).rejects.toThrow(/llave JSON nueva/);
  });
});

describe("link de la carpeta", () => {
  it("saca el id de los links de Drive y acepta el id solo", () => {
    expect(driveFolderId("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing")).toBe("1AbCdEfGhIjKlMnOp");
    expect(driveFolderId("https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp")).toBe("1AbCdEfGhIjKlMnOp");
    expect(driveFolderId("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp")).toBe("1AbCdEfGhIjKlMnOp");
    expect(driveFolderId("  1AbCdEfGhIjKlMnOp ")).toBe("1AbCdEfGhIjKlMnOp");
    expect(driveFolderId("https://example.com/foto.jpg")).toBeNull();
    expect(driveFolderId("hola")).toBeNull();
  });
});

describe("listar la carpeta", () => {
  beforeEach(() => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = KEY_JSON;
    clearTokenCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  });

  const FOLDER = "application/vnd.google-apps.folder";
  const SHORTCUT = "application/vnd.google-apps.shortcut";
  const img = (id: string, name: string, extra: object = {}) => ({ id, name, mimeType: "image/jpeg", size: "2048000", modifiedTime: "2026-01-02T10:00:00.000Z", ...extra });

  // Carpetas falsas: id → páginas de archivos.
  const tree: Record<string, object[][]> = {
    root: [
      [img("p1", "puerta.jpg", { imageMediaMetadata: { width: 4000, height: 3000, time: "2025:05:01 14:22:10" }, thumbnailLink: "https://lh3.googleusercontent.com/abc=s220" }), { id: "sub", name: "Trabajos", mimeType: FOLDER }],
      [
        { id: "v1", name: "video.mp4", mimeType: "video/mp4", size: "9000000", modifiedTime: "2026-01-03T10:00:00.000Z", videoMediaMetadata: { width: 1080, height: 1920, durationMillis: "12500" } },
        { id: "doc", name: "factura.pdf", mimeType: "application/pdf" },
        img("trash", "borrada.jpg", { trashed: true }),
        { id: "sc1", name: "Atajo carpeta", mimeType: SHORTCUT, shortcutDetails: { targetId: "shared", targetMimeType: FOLDER } },
        { id: "sc2", name: "Atajo foto.jpg", mimeType: SHORTCUT, shortcutDetails: { targetId: "p9", targetMimeType: "image/jpeg" } },
      ],
    ],
    sub: [[img("p2", "casa.jpg"), { id: "d2", name: "Nivel2", mimeType: FOLDER }]],
    shared: [[img("p3", "local.png", { mimeType: "image/png" }), { id: "root", name: "Vuelta", mimeType: FOLDER }]],
    d2: [[{ id: "d3", name: "Nivel3", mimeType: FOLDER }]],
    d3: [[{ id: "d4", name: "Nivel4", mimeType: FOLDER }]],
    d4: [[img("p4", "hondo.jpg"), { id: "d5", name: "Nivel5", mimeType: FOLDER }]],
    d5: [[img("p5", "muy-hondo.jpg")]],
  };

  function driveMock() {
    const calls: string[] = [];
    const fn = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.hostname === "oauth2.googleapis.com") return json({ access_token: "tok", expires_in: 3600 });
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      calls.push(url.pathname + url.search);
      if (url.pathname === "/drive/v3/files") {
        const parent = /'([^']+)' in parents/.exec(url.searchParams.get("q")!)![1];
        const pages = tree[parent] ?? [[]];
        const i = Number(url.searchParams.get("pageToken") ?? 0);
        return json({ files: pages[i], ...(i + 1 < pages.length ? { nextPageToken: String(i + 1) } : {}) });
      }
      if (url.pathname === "/drive/v3/files/p9") return json(img("p9", "original.jpg"));
      return json({ error: { code: 404, message: "File not found" } }, 404);
    });
    return { fn, calls };
  }

  it("recorre páginas, subcarpetas (hasta 4 niveles) y accesos directos, sin papelera ni documentos", async () => {
    const { fn, calls } = driveMock();
    vi.stubGlobal("fetch", fn);
    const files = await listMedia("root");
    const byId = Object.fromEntries(files.map((f) => [f.id, f]));
    expect(Object.keys(byId).sort()).toEqual(["p1", "p2", "p3", "p4", "p9", "v1"]);
    expect(byId.p2.folderPath).toBe("Trabajos");
    expect(byId.p3.folderPath).toBe("Atajo carpeta");
    expect(byId.p4.folderPath).toBe("Trabajos/Nivel2/Nivel3/Nivel4");
    expect(byId.p9).toMatchObject({ name: "Atajo foto.jpg", folderPath: "", kind: "photo" });
    expect(byId.p1).toMatchObject({ kind: "photo", width: 4000, height: 3000, sizeBytes: 2048000, thumbnailLink: "https://lh3.googleusercontent.com/abc=s220" });
    expect(byId.p1.takenAt?.toISOString()).toBe("2025-05-01T14:22:10.000Z");
    expect(byId.v1).toMatchObject({ kind: "video", durationSec: 12.5, width: 1080, height: 1920 });
    // Pidió la segunda página de la carpeta principal y nunca entró al nivel 5 ni volvió a la principal por el atajo.
    expect(calls.some((c) => c.includes("pageToken=1"))).toBe(true);
    expect(calls.some((c) => c.includes("d5"))).toBe(false);
    expect(calls.filter((c) => new URL(`https://x${c}`).searchParams.get("q")?.startsWith("'root' in parents"))).toHaveLength(2);
    // Siempre sin lo de la papelera y con los datos de foto y video.
    const q = new URL(`https://x${calls[0]}`).searchParams;
    expect(q.get("q")).toContain("trashed = false");
    expect(q.get("fields")).toContain("imageMediaMetadata");
    expect(q.get("fields")).toContain("videoMediaMetadata");
    expect(q.get("fields")).toContain("thumbnailLink");
  });

  it("si la carpeta no está compartida, dice con qué correo compartirla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => (input.includes("oauth2") ? json({ access_token: "tok" }) : json({ error: { code: 404, message: "File not found: x." } }, 404))),
    );
    await expect(listMedia("root")).rejects.toThrow(`Comparte la carpeta con ${EMAIL} como Lector`);
  });
});

describe("errores de Drive en palabras simples", () => {
  const E = "app@p.iam.gserviceaccount.com";
  const body = (reason: string, message = "x") => JSON.stringify({ error: { code: 403, message, errors: [{ reason }] } });
  it("no compartida (404 o 403 sin permiso)", () => {
    const a = driveApiError(404, JSON.stringify({ error: { code: 404, message: "File not found: abc." } }), E);
    expect(a.message).toBe(`La app no puede ver la carpeta. Comparte la carpeta con ${E} como Lector.`);
    expect(a.en).toContain(`Share the folder with ${E} as Viewer`);
    expect(driveApiError(403, body("insufficientFilePermissions"), E).message).toContain("como Lector");
  });
  it("la API de Drive no está activada en el proyecto", () => {
    expect(driveApiError(403, body("accessNotConfigured", "Google Drive API has not been used in project 123 before or it is disabled."), E).message).toContain("Google Drive API");
    const v2 = JSON.stringify({ error: { code: 403, status: "PERMISSION_DENIED", message: "x", details: [{ reason: "SERVICE_DISABLED" }] } });
    expect(driveApiError(403, v2, E).message).toContain("activar");
  });
  it("límite de consultas", () => {
    expect(driveApiError(403, body("userRateLimitExceeded"), E).message).toContain("límite");
    expect(driveApiError(429, "", E).message).toContain("límite");
  });
  it("otros errores", () => {
    expect(driveApiError(401, "", E).message).toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
    expect(driveApiError(500, "<html>", E).message).toContain("500");
  });
  it("miniatura en otro tamaño", () => {
    expect(thumbnailAt("https://lh3.googleusercontent.com/abc=s220", 800)).toBe("https://lh3.googleusercontent.com/abc=s800");
    expect(thumbnailAt("https://lh3.googleusercontent.com/abc", 512)).toBe("https://lh3.googleusercontent.com/abc=s512");
  });
});

const file = (id: string, extra: Partial<DriveFile> = {}): DriveFile => ({
  id,
  name: `${id}.jpg`,
  mimeType: "image/jpeg",
  kind: "photo",
  folderPath: "",
  sizeBytes: 1000,
  modifiedTime: "2026-01-01T00:00:00.000Z",
  width: 0,
  height: 0,
  durationSec: 0,
  takenAt: null,
  thumbnailLink: "",
  ...extra,
});
const known = (externalId: string, extra: Partial<KnownItem> = {}): KnownItem => ({
  id: `db-${externalId}`,
  externalId,
  status: "ready",
  name: `${externalId}.jpg`,
  folderPath: "",
  modifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  analyzed: true,
  ...extra,
});

describe("planear la revisión", () => {
  it("nuevos, cambiados (se vuelven a revisar), movidos, de vuelta y los que ya no están", () => {
    const plan = planSync(
      [known("same"), known("changed"), known("moved"), known("missing"), known("back", { status: "gone" }), known("gone-already", { status: "gone" })],
      [file("same"), file("changed", { modifiedTime: "2026-02-01T00:00:00.000Z" }), file("moved", { folderPath: "Trabajos" }), file("back"), file("brand-new")],
    );
    expect(plan.create.map((f) => f.id)).toEqual(["brand-new"]);
    expect(plan.gone).toEqual(["db-missing"]);
    const upd = Object.fromEntries(plan.update.map((u) => [u.id, u]));
    expect(Object.keys(upd).sort()).toEqual(["db-back", "db-changed", "db-moved"]);
    expect(upd["db-changed"]).toMatchObject({ reanalyze: true, revive: false });
    expect(upd["db-moved"]).toMatchObject({ reanalyze: false, revive: false });
    expect(upd["db-back"]).toMatchObject({ reanalyze: false, revive: true });
  });

  it("toma como mucho el límite, solo los nuevos y los más viejos primero", () => {
    const at = (s: string) => new Date(s);
    const items = [
      { id: "c", status: "new", modifiedAt: at("2026-03-01"), createdAt: at("2026-10-01") },
      { id: "a", status: "new", modifiedAt: at("2024-01-01"), createdAt: at("2026-10-01") },
      { id: "r", status: "ready", modifiedAt: at("2020-01-01"), createdAt: at("2026-10-01") },
      { id: "b", status: "new", modifiedAt: null, createdAt: at("2025-06-01") },
      { id: "e", status: "error", modifiedAt: at("2020-01-01"), createdAt: at("2026-10-01") },
      { id: "d", status: "new", modifiedAt: at("2026-09-01"), createdAt: at("2026-10-01") },
    ];
    expect(pickBatch(items, 3).map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(pickBatch(items).map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("lo que contesta la IA", () => {
  it("ordena por número, limpia etiquetas, deja la calidad entre 1 y 5 y solo avisos conocidos", () => {
    const raw = {
      items: [
        {
          n: 2,
          es: "Puerta enrollable gris en un local.",
          en: "Gray roll-up door at a shop.",
          scene: "done",
          topics: ["Cortinas Metálicas", "instalación"],
          tags: ["#Puerta", "metal", "metal", " Gris "],
          quality: 7,
          usable: true,
          reasonEs: "",
          reasonEn: "",
          privacy: ["plate", "aliens"],
        },
        { n: 1, es: "Captura de pantalla de WhatsApp.", en: "WhatsApp screenshot.", scene: "selfie", topics: [], tags: [], quality: 1, usable: false, reasonEs: "Es una captura de pantalla.", reasonEn: "It's a screenshot.", privacy: ["document"] },
        { n: 9, es: "fuera de rango", en: "", scene: "other", topics: [], tags: [], quality: 3, usable: true, reasonEs: "", reasonEn: "", privacy: [] },
        { n: 1, es: "repetido", en: "", scene: "other", topics: [], tags: [], quality: 3, usable: true, reasonEs: "", reasonEn: "", privacy: [] },
      ],
    };
    const out = parseAnalysis(raw, 3);
    expect([...out.keys()].sort()).toEqual([1, 2]);
    expect(out.get(2)).toEqual({
      description: { es: "Puerta enrollable gris en un local.", en: "Gray roll-up door at a shop.", scene: "done", topics: ["cortinas metálicas", "instalación"] },
      tags: ["puerta", "metal", "gris"],
      quality: 5,
      usable: true,
      privacy: ["plate"],
    });
    expect(out.get(1)).toMatchObject({ usable: false, quality: 1, privacy: ["document"] });
    expect(out.get(1)!.description).toMatchObject({ scene: "other", reason: { es: "Es una captura de pantalla.", en: "It's a screenshot." } });
    // Sin los campos de la mejora (respuesta vieja): sin indicaciones.
    expect(out.get(2)!.hints).toBeUndefined();
    const withHints = parseAnalysis(
      { items: [{ n: 1, es: "Carro frente a la casa.", en: "Car in front of the house.", scene: "done", topics: [], tags: [], quality: 4, usable: true, reasonEs: "", reasonEn: "", privacy: ["plate"], straighten: -1.5, focusX: 0.5, focusY: 0.6, hide: [{ what: "plate", box: [800, 400, 850, 500] }] }] },
      1,
    );
    expect(withHints.get(1)!.hints).toMatchObject({ rotate: -1.5, focus: { x: 0.5, y: 0.6 }, hide: [{ reason: "plate" }], from: "review" });
    expect(parseAnalysis(null, 3).size).toBe(0);
    expect(parseAnalysis({ items: "x" }, 3).size).toBe(0);
  });
});

describe("mensaje para el dueño", () => {
  const t = translator("es");
  const base: SyncResult = { ok: true, added: 0, analyzed: 0, pending: 0, gone: 0, errors: 0, stopped: "", error: "" };
  it("dice lo que pasó en palabras simples", () => {
    expect(syncMessage(base, t)).toBe("Nada nuevo en la carpeta.");
    expect(syncMessage({ ...base, added: 30, analyzed: 25, pending: 5 }, t)).toBe(
      "30 archivos nuevos, la IA revisó 25. Faltan 5 por revisar: se revisan solas cada día, o presiona «Revisar ahora» otra vez.",
    );
    expect(syncMessage({ ...base, added: 3, pending: 3, stopped: "noai" }, t)).toContain("GEMINI_API_KEY");
    expect(syncMessage({ ...base, ok: false, error: "Comparte la carpeta" }, t)).toBe("Comparte la carpeta");
  });
});
