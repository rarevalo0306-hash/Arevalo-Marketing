import { describe, expect, it } from "vitest";
import { typeOfKind } from "@/lib/proposals-log";
import { tagsLength } from "@/lib/video-plan";
import {
  parseYoutubeTags,
  readYoutubeApproval,
  withoutYoutubeApproval,
  YT_KEY,
  youtubeApprovalFromForm,
  youtubeApprovalLog,
  youtubeSummary,
  youtubeTags,
  youtubeTitleFor,
  type YoutubeApproval,
} from "@/lib/youtube-options";

const VIDEO = "https://x.supabase.co/storage/v1/object/public/media/b/reel.mp4";
const ok: YoutubeApproval = {
  title: "Cortinas metálicas en Managua",
  description: "Instalamos tu cortina en un día.",
  tags: ["cortinas metálicas", "Managua"],
  privacy: "unlisted",
  madeForKids: false,
  mediaUrl: VIDEO,
  approvedBy: "user1",
  approvedAt: "2026-10-13T12:00:00.000Z",
};
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const full = { yt_title: "Mi video", v_youtube: "La descripción", yt_tags: "a b, cortinas, a b", yt_privacy: "private", yt_kids: "no" };

describe("la aprobación guardada solo sirve para ese video y con todo elegido", () => {
  it("lee una aprobación completa (junto a los textos de cada red)", () => {
    const variants = { youtube: "La descripción", facebook: "Hola", [YT_KEY]: ok };
    expect(readYoutubeApproval(variants, VIDEO)).toEqual(ok);
    // Los textos de cada red siguen siendo texto.
    expect(typeof variants.youtube).toBe("string");
  });

  it("nada si falta, no es un objeto o no tiene lo esencial", () => {
    for (const v of [null, undefined, "x", [], {}, { [YT_KEY]: "x" }, { [YT_KEY]: [] }]) expect(readYoutubeApproval(v, VIDEO), JSON.stringify(v)).toBeNull();
    const bad: Partial<Record<keyof YoutubeApproval, unknown>>[] = [
      { privacy: "everyone" },
      { privacy: undefined },
      { madeForKids: "no" },
      { madeForKids: undefined },
      { approvedBy: "" },
      { approvedBy: "   " },
      { approvedBy: undefined },
      { mediaUrl: "" },
      { title: "" },
      { title: "<>" },
    ];
    for (const patch of bad) expect(readYoutubeApproval({ [YT_KEY]: { ...ok, ...patch } }, VIDEO), JSON.stringify(patch)).toBeNull();
  });

  it("si la publicación cambió de video (o no tiene), la aprobación ya no sirve", () => {
    expect(readYoutubeApproval({ [YT_KEY]: ok }, "https://x.supabase.co/otro.mp4")).toBeNull();
    expect(readYoutubeApproval({ [YT_KEY]: ok }, "")).toBeNull();
  });

  it("limpia lo guardado: solo etiquetas de texto (≤ 500), título sin < >", () => {
    const many = Array.from({ length: 80 }, (_, i) => `etiqueta larga número ${i}`);
    const a = readYoutubeApproval({ [YT_KEY]: { ...ok, title: "<b>Hola</b>", tags: ["a1", 3, null, ...many] } }, VIDEO)!;
    expect(a.title).toBe("bHola/b");
    expect(a.tags[0]).toBe("a1");
    expect(a.tags.every((x) => typeof x === "string")).toBe(true);
    expect(tagsLength(a.tags)).toBeLessThanOrEqual(500);
  });

  it("quitarla de unas variantes (al copiar o volver a guardar)", () => {
    expect(withoutYoutubeApproval({ youtube: "d", [YT_KEY]: ok })).toEqual({ youtube: "d" });
    expect(withoutYoutubeApproval(null)).toEqual({});
  });
});

describe("los campos de YouTube que envía la persona", () => {
  const o = { mediaUrl: VIDEO, approvedBy: "user1", now: new Date("2026-10-13T12:00:00Z") };

  it("arma la aprobación con lo elegido", () => {
    const r = youtubeApprovalFromForm(form(full), o);
    expect(r).toEqual({
      ok: true,
      value: {
        title: "Mi video",
        description: "La descripción",
        tags: ["a b", "cortinas"],
        privacy: "private",
        madeForKids: false,
        mediaUrl: VIDEO,
        approvedBy: "user1",
        approvedAt: "2026-10-13T12:00:00.000Z",
      },
    });
    expect(youtubeApprovalFromForm(form({ ...full, yt_kids: "yes", yt_privacy: "public" }), o)).toMatchObject({ ok: true, value: { madeForKids: true, privacy: "public" } });
  });

  it("sin privacidad no hay aprobación (nunca se pone una por defecto)", () => {
    const { yt_privacy: _drop, ...rest } = full;
    void _drop;
    for (const f of [form(rest), form({ ...full, yt_privacy: "" }), form({ ...full, yt_privacy: "everyone" })]) {
      const r = youtubeApprovalFromForm(f, o);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.en).toBe("Choose who can see the video on YouTube: public, unlisted or private.");
    }
  });

  it("sin decir si es para niños, sin título, sin video o sin persona, tampoco", () => {
    const { yt_kids: _k, ...noKids } = full;
    void _k;
    const r1 = youtubeApprovalFromForm(form(noKids), o);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.en).toMatch(/made for kids/);
    expect(youtubeApprovalFromForm(form({ ...full, yt_kids: "maybe" }), o).ok).toBe(false);
    expect(youtubeApprovalFromForm(form({ ...full, yt_title: "  <> " }), o).ok).toBe(false);
    expect(youtubeApprovalFromForm(form(full), { ...o, mediaUrl: "" }).ok).toBe(false);
    expect(youtubeApprovalFromForm(form(full), { ...o, approvedBy: " " }).ok).toBe(false);
  });

  it("el título va tal cual (sin < > y ≤ 100); la descripción ≤ 5000; la pantalla puede mandar su propio texto", () => {
    const r = youtubeApprovalFromForm(form({ ...full, yt_title: `  <i>${"Portones ".repeat(20)}</i>`, v_youtube: "x".repeat(6000) }), o);
    if (!r.ok) throw new Error("no");
    expect(r.value.title.length).toBeLessThanOrEqual(100);
    expect(r.value.title).not.toMatch(/[<>]/);
    expect(r.value.title.startsWith("iPortones Portones")).toBe(true);
    expect(r.value.description).toHaveLength(5000);
    const own = youtubeApprovalFromForm(form(full), { ...o, description: "Texto de <YouTube> del Composer" });
    expect(own.ok && own.value.description).toBe("Texto de YouTube del Composer");
  });

  it("etiquetas separadas por comas, sin repetir y ≤ 500 caracteres", () => {
    expect(parseYoutubeTags(" a1, , b2 ,a1,#c3 ")).toEqual(["a1", "b2", "c3"]);
    expect(tagsLength(parseYoutubeTags(Array.from({ length: 100 }, (_, i) => `etiqueta ${i}`).join(",")))).toBeLessThanOrEqual(500);
  });
});

describe("sugerencias y resumen", () => {
  it("título sugerido: seoTitle, o la primera línea sin hashtags ni enlaces, o el nombre", () => {
    expect(youtubeTitleFor({ seoTitle: " Mi título ", text: "x", businessName: "Fameseg" })).toBe("Mi título");
    expect(youtubeTitleFor({ seoTitle: "", text: "#Promo https://x.com Portones nuevos\nOtra", businessName: "Fameseg" })).toBe("Portones nuevos");
    expect(youtubeTitleFor({ seoTitle: "", text: "", businessName: "Fameseg" })).toBe("Fameseg");
    expect(youtubeTitleFor({ seoTitle: "Portones ".repeat(30), text: "", businessName: "" }).length).toBeLessThanOrEqual(100);
  });

  it("etiquetas sugeridas: palabras clave y hashtags del texto (sin #Shorts)", () => {
    expect(youtubeTags("Hola #CortinasMetalicas #Shorts", ["portones"])).toEqual(["portones", "Cortinas Metalicas"]);
  });

  it("resumen en una línea, en los dos idiomas", () => {
    expect(youtubeSummary(ok, "en")).toBe("YouTube: “Cortinas metálicas en Managua” · Unlisted · Not made for kids · Tags: cortinas metálicas, Managua");
    expect(youtubeSummary({ ...ok, privacy: "private", madeForKids: true, tags: [] }, "es")).toBe("YouTube: «Cortinas metálicas en Managua» · Privado · Para niños · Sin etiquetas");
  });

  it("la constancia del registro: quién aprobó y exactamente qué", () => {
    const row = youtubeApprovalLog("biz1", "p1", ok, "c1");
    expect(row).toMatchObject({ businessId: "biz1", postId: "p1", campaignId: "c1", kind: "post.youtube_approved", actor: "owner", detail: ok });
    // Se ve en «Lo que hizo la IA» → Publicaciones.
    expect(typeOfKind(String(row.kind))).toBe("publicaciones");
  });
});
