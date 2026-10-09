import { describe, expect, it } from "vitest";
import {
  applyEdits,
  applyTextEdits,
  cityCased,
  buildTexts,
  cleanCaption,
  composeTracks,
  estimateCostCents,
  fitDurations,
  fitTags,
  frameCounts,
  fromAi,
  hasKeyword,
  hashtagOf,
  kenBurnsRect,
  pickKeyword,
  readVideoProject,
  socialCaption,
  storyboardPrompt,
  tagsLength,
  templateStoryboard,
  totalSec,
  videoFileName,
  youtubeTitle,
  type PlanContext,
  type VideoMedia,
} from "@/lib/video-plan";

const photo = (id: string, focus: { x: number; y: number } | null = null): VideoMedia => ({ id, kind: "photo", url: `https://x.supabase.co/${id}.jpg`, thumb: "", focus, width: 1600, height: 1200, durationSec: 0, about: "cortina metálica instalada en un local" });
const clip = (id: string, sec: number): VideoMedia => ({ id, kind: "video", url: `https://x.supabase.co/${id}.mp4`, thumb: "", focus: null, width: 1080, height: 1920, durationSec: sec, about: "instalación en proceso" });

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  idea: "Mostrar la instalación de cortinas metálicas para locales",
  format: "vertical",
  lang: "es",
  media: [photo("a", { x: 0.7, y: 0.4 }), photo("b"), clip("c", 6)],
  business: { name: "Fameseg", phone: "+505 8888 0000", website: "fameseg.com", city: "Managua", hashtags: "#Fameseg #PuertasEnrollables", slogan: "Seguridad que se enrolla", logoUrl: "", logoLightUrl: "", color: "#C8102E", color2: "", fontHeading: "montserrat" },
  keywords: ["puertas enrollables", "cortinas metálicas", "portones eléctricos", "Cortinas Metalicas"],
  music: { moods: ["enérgica", "confiable"], genres: ["corporate pop"], bpmMin: 100, bpmMax: 120, instruments: ["guitarra"], searchTerms: [] },
  ...over,
});

describe("textos cortos y palabras clave", () => {
  it("deja como mucho 6 palabras con mayúscula inicial", () => {
    expect(cleanCaption("instalamos tu cortina metálica hoy mismo en Managua sin costo")).toBe("Instalamos tu cortina metálica hoy mismo");
    expect(cleanCaption("  #oferta  ")).toBe("Oferta");
  });
  it("reconoce la palabra clave sin importar tildes ni plurales", () => {
    expect(hasKeyword("Cortina metalica en Managua", "cortinas metálicas")).toBe(true);
    expect(hasKeyword("Portones nuevos", "cortinas metálicas")).toBe(false);
  });
  it("elige la palabra clave que más se parece a la idea", () => {
    expect(pickKeyword("cortinas para locales", ["puertas enrollables", "cortinas metálicas"])).toBe("cortinas metálicas");
    expect(pickKeyword("algo distinto", ["puertas enrollables", "cortinas metálicas"])).toBe("puertas enrollables");
  });
  it("la ciudad dentro de la palabra clave va con mayúscula", () => {
    expect(cityCased("cortinas metálicas managua", "Managua")).toBe("cortinas metálicas Managua");
    expect(cityCased("portones san josé costa rica", "San José")).toBe("portones San José costa rica");
    expect(youtubeTitle("", { keyword: "cortinas metálicas managua", city: "Managua", name: "Fameseg", format: "vertical", lang: "es" })).toBe("Cortinas metálicas Managua | Fameseg #Shorts");
  });
  it("hashtags sin tildes ni espacios", () => {
    expect(hashtagOf("cortinas metálicas Managua")).toBe("#CortinasMetalicasManagua");
  });
});

describe("guion de respaldo", () => {
  const sb = templateStoryboard(ctx());
  it("tiene de 5 a 8 escenas: gancho primero y cierre con la marca al final", () => {
    expect(sb.scenes.length).toBeGreaterThanOrEqual(5);
    expect(sb.scenes.length).toBeLessThanOrEqual(8);
    expect(sb.scenes[0].role).toBe("hook");
    expect(sb.scenes.at(-1)!.role).toBe("outro");
    expect(sb.scenes.at(-1)!.caption).toBe("Seguridad que se enrolla");
  });
  it("el gancho dura 2 s y lleva la palabra clave", () => {
    expect(sb.scenes[0].durationSec).toBe(2);
    expect(hasKeyword(sb.scenes[0].caption, sb.keyword)).toBe(true);
    expect(sb.keyword).toBe("cortinas metálicas");
  });
  it("vertical dura entre 15 y 30 s; cada texto ≤ 6 palabras", () => {
    const total = totalSec(sb.scenes);
    expect(total).toBeGreaterThanOrEqual(15);
    expect(total).toBeLessThanOrEqual(30);
    for (const s of sb.scenes) expect(s.caption.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(6);
  });
  it("los clips no duran más que el video real", () => {
    const c = sb.scenes.find((s) => s.mediaId === "c")!;
    expect(c.durationSec).toBeLessThanOrEqual(6);
  });
  it("repite fotos si hay pocas (con otro movimiento)", () => {
    const one = templateStoryboard(ctx({ media: [photo("a")] }));
    expect(one.scenes.filter((s) => s.role !== "outro")).toHaveLength(4);
    expect(new Set(one.scenes.filter((s) => s.role !== "outro").map((s) => s.motion)).size).toBeGreaterThan(1);
  });
  it("la música sale de la identidad de marca", () => {
    expect(sb.music.bpm).toBe(110);
    expect(sb.music.prompt).toMatch(/110 BPM/);
    expect(sb.music.prompt).toMatch(/no vocals/);
  });
  it("horizontal (YouTube) dura entre 20 y 60 s", () => {
    const h = templateStoryboard(ctx({ format: "horizontal" }));
    expect(totalSec(h.scenes)).toBeGreaterThanOrEqual(20);
    expect(totalSec(h.scenes)).toBeLessThanOrEqual(60);
  });
});

describe("textos para cada red", () => {
  const sb = templateStoryboard(ctx());
  it("título de YouTube con palabra clave, ciudad y #Shorts, ≤ 100", () => {
    expect(sb.texts.title.length).toBeLessThanOrEqual(100);
    expect(sb.texts.title).toMatch(/Managua/);
    expect(sb.texts.title).toMatch(/#Shorts$/);
    expect(hasKeyword(sb.texts.title, "cortinas metálicas")).toBe(true);
    const long = youtubeTitle("Un título larguísimo ".repeat(10), { keyword: "cortinas metálicas", city: "Managua", name: "Fameseg", format: "horizontal", lang: "es" });
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long).not.toMatch(/#Shorts/);
  });
  it("descripción con palabras clave, teléfono y enlace", () => {
    expect(sb.texts.description).toMatch(/\+505 8888 0000/);
    expect(sb.texts.description).toMatch(/https:\/\/fameseg\.com/);
    expect(sb.texts.description).toMatch(/puertas enrollables/);
  });
  it("etiquetas sin repetir y ≤ 500 caracteres", () => {
    expect(tagsLength(sb.texts.tags)).toBeLessThanOrEqual(500);
    expect(sb.texts.tags.filter((t) => t.toLowerCase() === "cortinas metalicas" || t.toLowerCase() === "cortinas metálicas")).toHaveLength(1);
    const many = fitTags(Array.from({ length: 80 }, (_, i) => `etiqueta número ${i}`));
    expect(tagsLength(many)).toBeLessThanOrEqual(500);
  });
  it("Instagram y TikTok: ≤ 5 hashtags, palabra clave y ciudad; el enlace solo en Facebook", () => {
    for (const text of [sb.texts.instagram, sb.texts.tiktok]) {
      expect((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length).toBeLessThanOrEqual(5);
      expect(text).toMatch(/Managua/);
      expect(text).not.toMatch(/https?:\/\//);
    }
    expect(sb.texts.facebook).toMatch(/https:\/\/fameseg\.com/);
    expect(socialCaption("Mira este trabajo", { keyword: "cortinas metálicas", city: "Managua", phone: "", website: "", lang: "es", hashtags: [] }, "instagram")).toMatch(/^Cortinas metálicas en Managua: Mira este trabajo/);
  });
  it("los cambios del dueño respetan los mínimos", () => {
    const t = applyTextEdits(sb, { title: "Mi video", instagram: "Hola #a #b #c #d #e #f #g" });
    expect(t.title).toMatch(/cortinas metálicas/i);
    expect(t.title).toMatch(/Managua/);
    expect((t.instagram.match(/#\w+/g) ?? []).length).toBe(5);
  });
});

describe("guion de la IA", () => {
  it("usa las escenas de la IA, corrige el gancho y agrega el cierre", () => {
    const sb = fromAi(ctx(), {
      scenes: [
        { media: 1, caption: "Mira esto ahora mismo, de verdad", motion: "zoom-in" },
        { media: 0, caption: "Trabajo terminado", motion: "pan-left" },
        { media: 9, caption: "No existe", motion: "still" },
        { media: 2, caption: "Instalación rápida", motion: "still" },
        { media: 0, caption: "Llámanos hoy", motion: "zoom-out" },
      ],
      outroCaption: "x",
      title: "Instalación de cortinas metálicas",
      summary: "Instalamos cortinas metálicas para locales.",
      caption: "Instalamos cortinas metálicas para tu local.",
    })!;
    expect(sb.source).toBe("ai");
    expect(sb.scenes[0].mediaId).toBe("b");
    expect(hasKeyword(sb.scenes[0].caption, "cortinas metálicas")).toBe(true);
    expect(sb.scenes.filter((s) => s.role !== "outro")).toHaveLength(4);
    expect(sb.scenes.at(-1)!.role).toBe("outro");
    expect(sb.texts.title).toMatch(/Managua #Shorts$/);
  });
  it("el pedido lleva la palabra clave, las fotos y las reglas", () => {
    const { system, user } = storyboardPrompt(ctx(), "cortinas metálicas", ["cortinas metálicas", "puertas enrollables"]);
    expect(system).toMatch(/15-30 seconds/);
    expect(system).toMatch(/cortinas metálicas/);
    expect(user).toMatch(/0\. PHOTO/);
    expect(user).toMatch(/2\. CLIP \(6 s\)/);
  });
  it("si la IA no usa ninguna foto válida, no sirve", () => {
    expect(fromAi(ctx(), { scenes: [{ media: 7, caption: "x", motion: "still" }], outroCaption: "", title: "", summary: "", caption: "" })).toBeNull();
  });
});

describe("cambios del dueño en las escenas", () => {
  const sb = templateStoryboard(ctx({ media: [photo("a"), photo("b"), photo("d"), photo("e"), photo("f")] }));
  const edits = sb.scenes.map((s) => ({ id: s.id, caption: s.caption, motion: s.motion }));
  it("reordenar: la nueva primera escena es el gancho (2 s, con palabra clave)", () => {
    const [first, second, ...rest] = edits;
    const out = applyEdits(sb, [{ ...second, caption: "Antes y después" }, first, ...rest]);
    expect(out.scenes[0].id).toBe(second.id);
    expect(out.scenes[0].role).toBe("hook");
    expect(out.scenes[0].durationSec).toBe(2);
    expect(hasKeyword(out.scenes[0].caption, "cortinas metálicas")).toBe(true);
    expect(out.scenes.at(-1)!.role).toBe("outro");
  });
  it("quitar de más: siempre quedan al menos 4 escenas con foto", () => {
    const out = applyEdits(sb, [edits[0], edits.at(-1)!]);
    expect(out.scenes.filter((s) => s.role !== "outro").length).toBeGreaterThanOrEqual(4);
    expect(totalSec(out.scenes)).toBeGreaterThanOrEqual(15);
  });
  it("corta los textos largos a 6 palabras", () => {
    const out = applyEdits(sb, edits.map((e, i) => (i === 1 ? { ...e, caption: "uno dos tres cuatro cinco seis siete ocho" } : e)));
    expect(out.scenes[1].caption).toBe("Uno dos tres cuatro cinco seis");
  });
});

describe("duraciones", () => {
  it("encoge si se pasa de 30 s en vertical", () => {
    const media = Array.from({ length: 7 }, (_, i) => photo(`p${i}`));
    const scenes = [
      ...media.map((m, i) => ({ id: `s${i}`, role: i === 0 ? ("hook" as const) : ("body" as const), mediaId: m.id, durationSec: 5, motion: "still" as const, caption: "" })),
      { id: "o", role: "outro" as const, mediaId: "", durationSec: 3, motion: "still" as const, caption: "" },
    ];
    expect(totalSec(fitDurations(scenes, media, "vertical"))).toBeLessThanOrEqual(30);
  });
});

describe("movimiento Ken Burns", () => {
  const src = { w: 1600, h: 1200 };
  const out = { w: 1080, h: 1920 };
  it("el recorte tiene la forma del video y no se sale de la foto", () => {
    for (const motion of ["zoom-in", "zoom-out", "pan-left", "pan-right", "still"] as const) {
      for (const p of [0, 0.5, 1]) {
        const r = kenBurnsRect(motion, p, src, out, { x: 0.9, y: 0.1 });
        expect(r.left).toBeGreaterThanOrEqual(0);
        expect(r.top).toBeGreaterThanOrEqual(0);
        expect(r.left + r.width).toBeLessThanOrEqual(src.w);
        expect(r.top + r.height).toBeLessThanOrEqual(src.h);
        expect(Math.abs(r.width / r.height - out.w / out.h)).toBeLessThan(0.02);
      }
    }
  });
  it("acercar: termina más cerca y centrado en lo importante", () => {
    const a = kenBurnsRect("zoom-in", 0, src, out, { x: 0.6, y: 0.5 });
    const b = kenBurnsRect("zoom-in", 1, src, out, { x: 0.6, y: 0.5 });
    expect(b.width).toBeLessThan(a.width);
    expect(Math.abs(b.left + b.width / 2 - 0.6 * src.w)).toBeLessThan(2);
  });
  it("mover a la derecha: el recorte avanza a la derecha", () => {
    const a = kenBurnsRect("pan-right", 0, src, out, null);
    const b = kenBurnsRect("pan-right", 1, src, out, null);
    expect(b.left).toBeGreaterThan(a.left);
  });
  it("cuadros por escena con tope total", () => {
    const kinds = new Map([["a", "photo" as const], ["c", "video" as const]]);
    const scenes = [
      { role: "hook" as const, mediaId: "a", motion: "zoom-in" as const, durationSec: 2 },
      { role: "body" as const, mediaId: "c", motion: "zoom-in" as const, durationSec: 4 },
      { role: "body" as const, mediaId: "a", motion: "still" as const, durationSec: 3 },
      { role: "outro" as const, mediaId: "", motion: "still" as const, durationSec: 3 },
    ];
    expect(frameCounts(scenes, kinds, 6, 150)).toEqual([12, 1, 1, 1]);
    expect(frameCounts(scenes, kinds, 6, 6)[0]).toBe(6);
  });
});

describe("costo, archivo y pistas", () => {
  it("costo en centavos (compose US$0.0002/s + música US$0.02/min)", () => {
    expect(estimateCostCents({ totalSec: 20, music: true })).toBe(2);
    expect(estimateCostCents({ totalSec: 20, music: false })).toBe(1);
    expect(estimateCostCents({ totalSec: 60, music: true })).toBe(4);
  });
  it("nombre del archivo con palabra clave y ciudad", () => {
    expect(videoFileName("cortinas metálicas", "Managua", "vertical", "a1b2c3")).toBe("cortinas-metalicas-managua-reel-a1b2c3.mp4");
    expect(videoFileName("cortinas metálicas Managua", "Managua", "horizontal")).toBe("cortinas-metalicas-managua-youtube.mp4");
  });
  it("pistas de FFmpeg compose: cuadros y música debajo", () => {
    const tracks = composeTracks([{ url: "https://x/1.jpg", timestamp: 0, duration: 166.7 }], "https://fal.media/m.wav", 18000);
    expect(tracks).toEqual([
      { id: "visual", type: "video", keyframes: [{ timestamp: 0, duration: 167, url: "https://x/1.jpg" }] },
      { id: "music", type: "audio", keyframes: [{ timestamp: 0, duration: 18000, url: "https://fal.media/m.wav" }] },
    ]);
    expect(composeTracks([], "", 1000)).toHaveLength(1);
  });
  it("lee un proyecto guardado sin confiar en él", () => {
    const sb = templateStoryboard(ctx());
    const p = readVideoProject(JSON.parse(JSON.stringify({ v: 1, status: "ready", storyboard: sb, job: null, videoUrl: "https://x/v.mp4", thumbUrl: "", error: "", costCents: 2, postId: "", updatedAt: "" })));
    expect(p?.status).toBe("ready");
    expect(p?.storyboard.scenes).toHaveLength(sb.scenes.length);
    expect(readVideoProject({ status: "ready" })).toBeNull();
    expect(readVideoProject({ storyboard: { ...sb, scenes: [{ id: "x", caption: "uno dos tres cuatro cinco seis siete", motion: "hack" }] } })?.storyboard.scenes[0]).toMatchObject({ motion: "still", caption: "Uno dos tres cuatro cinco seis" });
  });
  it("buildTexts en inglés", () => {
    const sb = templateStoryboard(ctx({ lang: "en", keywords: ["roll-up doors"], idea: "roll-up doors for shops" }));
    const t = buildTexts(sb);
    expect(t.title).toMatch(/Roll-up doors in Managua/);
    expect(t.description).toMatch(/Contact — Fameseg/);
  });
});
