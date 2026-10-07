import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { decideReconnect } from "@/lib/connection-health";
import { classifyFailure, explainFailure, explainSent, needsReconnect, ownerMustAct, viewLabel } from "@/lib/publish-errors";

const PERM =
  "400: Any of the pages_read_engagement, pages_manage_metadata, pages_read_user_content, pages_manage_ads, pages_show_list or pages_messaging permission(s) must be granted before impersonating a user's page.";
const BIZ = "biz1";

describe("errores de publicación en palabras sencillas", () => {
  it("el permiso de Facebook quitado → volver a conectar Facebook", () => {
    expect(classifyFailure(PERM, "facebook")).toBe("reconnect-meta");
    expect(classifyFailure(PERM, "instagram")).toBe("reconnect-meta");
    const ex = explainFailure("facebook", PERM, "es", BIZ);
    expect(ex.message).toBe("Facebook quitó el permiso para publicar en tu página. Vuelve a conectar Facebook en Conexiones (toma 1 minuto).");
    expect(ex.action?.href).toBe("/b/biz1/conexiones#c-facebook");
    expect(ex.ownerMustAct).toBe(true);
    expect(ex.technical).toBe(PERM);
    // Instagram se arregla reconectando Facebook.
    expect(explainFailure("instagram", PERM, "en", BIZ).action?.href).toBe("/b/biz1/conexiones#c-facebook");
    expect(explainFailure("instagram", PERM, "en", BIZ).message).toMatch(/Reconnect Facebook/);
  });
  it("token de Facebook vencido o inválido", () => {
    for (const d of [
      "400: Error validating access token: Session has expired on Monday, 05-Oct-26",
      "400: Error validating access token: The session has been invalidated because the user changed their password",
      "400: Invalid OAuth access token - Cannot parse access token",
      "403: (#200) The user hasn't authorized the application to perform this action",
    ])
      expect(classifyFailure(d, "facebook")).toBe("reconnect-meta");
  });
  it("email sin contactos (error viejo y el nuevo motivo de salto)", () => {
    expect(classifyFailure("No hay contactos con email que hayan aceptado recibir correos.", "email")).toBe("no-email-contacts");
    expect(classifyFailure("No tienes contactos que hayan aceptado recibir correos, así que no se envió el email.", "email")).toBe("no-email-contacts");
    const ex = explainFailure("email", "No hay contactos con email que hayan aceptado recibir correos.", "es", BIZ);
    expect(ex.message).toMatch(/^No tienes contactos para correo/);
    expect(ex.message).toMatch(/Quita Email de los canales/);
    expect(ex.action?.href).toBe("/b/biz1/contactos");
  });
  it("SMS sin contactos", () => {
    expect(classifyFailure("No hay contactos con teléfono que hayan aceptado recibir textos.", "sms")).toBe("no-sms-contacts");
  });
  it("sitio web no preparado", () => {
    const d = "Tu sitio todavía no está preparado: falta content/articles.json en rarevalo0306-hash/fameseg-web-claude (main).";
    expect(classifyFailure(d, "seo")).toBe("website-not-ready");
    const ex = explainFailure("seo", d, "en", BIZ);
    expect(ex.message).toMatch(/website isn't set up yet/);
    expect(ex.action?.href).toBe("/b/biz1/conexiones#c-seo");
    expect(ex.ownerMustAct).toBe(true);
  });
  it("canal no conectado, falta foto o video", () => {
    expect(classifyFailure("TikTok no está conectado para este negocio", "tiktok")).toBe("not-connected");
    expect(explainFailure("tiktok", "TikTok no está conectado para este negocio", "es", BIZ).action?.label).toBe("Conectar TikTok");
    expect(classifyFailure("Instagram necesita una foto o un video.", "instagram")).toBe("needs-media");
    expect(classifyFailure("TikTok necesita un video para publicar.", "tiktok")).toBe("needs-video");
    expect(classifyFailure("Faltan datos de la conexión: pageId", "facebook")).toBe("missing-fields");
  });
  it("claves vencidas de otros servicios", () => {
    expect(classifyFailure("401: Bad credentials", "seo")).toBe("reconnect");
    expect(classifyFailure("400: invalid_grant — Token has been expired or revoked.", "google")).toBe("reconnect");
    expect(classifyFailure("401: Key not found", "email")).toBe("reconnect");
  });
  it("problemas pasajeros se pueden reintentar", () => {
    const d = "500: An unexpected error has occurred. Please retry your request later.";
    expect(classifyFailure(d, "facebook")).toBe("temporary");
    expect(ownerMustAct("temporary")).toBe(false);
    expect(classifyFailure("fetch failed", "google")).toBe("temporary");
    expect(explainFailure("facebook", d, "es", BIZ).message).toMatch(/problema pasajero/);
  });
  it("error desconocido: mensaje sencillo y el detalle técnico aparte", () => {
    const ex = explainFailure("facebook", "400: Something weird", "es", BIZ);
    expect(ex.kind).toBe("unknown");
    expect(ex.message).not.toMatch(/Something weird/);
    expect(ex.technical).toBe("400: Something weird");
    expect(ex.ownerMustAct).toBe(false);
  });
  it("needsReconnect solo para permisos/claves", () => {
    expect(needsReconnect(PERM, "facebook")).toBe(true);
    expect(needsReconnect("No hay contactos con email que hayan aceptado recibir correos.", "email")).toBe(false);
    expect(needsReconnect("500: boom", "facebook")).toBe(false);
  });
  it("lo que salió bien", () => {
    expect(viewLabel("facebook", "es")).toBe("Ver en Facebook");
    expect(viewLabel("instagram", "en")).toBe("See on Instagram");
    expect(explainSent("email", "Email enviado a 3 contactos", "en")).toBe("Email sent to 3 contacts");
    expect(explainSent("tiktok", "Enviado a TikTok, se procesa en unos minutos. Id v_123", "es")).toBe("Enviado a TikTok, se procesa en unos minutos");
  });
});

describe("¿necesita volver a conectarse?", () => {
  const failedAt = new Date("2026-10-06T06:35:00Z");
  const last = { channel: "facebook", status: "failed", detail: PERM, at: failedAt };
  it("sí, si el último intento falló por permisos y no se ha reconectado desde entonces", () => {
    expect(decideReconnect(last, new Date("2026-10-01T00:00:00Z"))).toEqual({ since: failedAt, detail: PERM });
  });
  it("no, si se volvió a conectar después del fallo", () => {
    expect(decideReconnect(last, new Date("2026-10-06T07:00:00Z"))).toBeNull();
  });
  it("no, si el último intento salió bien o falló por otra cosa", () => {
    expect(decideReconnect({ ...last, status: "sent", detail: "Publicado en Facebook" }, new Date(0))).toBeNull();
    expect(decideReconnect({ ...last, detail: "500: boom" }, new Date(0))).toBeNull();
    expect(decideReconnect(null, new Date(0))).toBeNull();
    expect(decideReconnect(last, null)).toBeNull();
  });
});
