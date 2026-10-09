import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDesign } from "@/lib/design";
import {
  cleanBox,
  DESIGN_MODELS,
  designModels,
  estimateUsd,
  falRequest,
  ideogramRequest,
  inkFor,
  masterPrompt,
  maxUsd,
  overlap,
  parseModelList,
  placeholderBox,
  pollMaster,
  resolveAreas,
  submitMaster,
  type MasterBrief,
} from "@/lib/design-ai";
import { customBase, customBoxes, customFor, CustomSpec, isMaster, PHOTO_BOXES, pickTemplate, StoredTemplate, textBox } from "@/lib/design-shapes";

const brief: MasterBrief = {
  name: "Fameseg",
  about: "Cortinas metálicas enrollables en Managua.",
  color: "#bb1111",
  color2: "#1f2937",
  color3: "#f59e0b",
  fontHeading: "oswald",
  fontBody: "Open Sans",
  personality: ["fuerte", "confiable"],
};
const model = (id: string) => DESIGN_MODELS.find((m) => m.id === id)!;

afterEach(() => vi.unstubAllGlobals());

describe("pedido del director de arte", () => {
  it("lleva los colores, la forma y la instrucción de diseño", () => {
    const { prompt, negative } = masterPrompt(brief, "story");
    expect(prompt).toContain("#BB1111");
    expect(prompt).toContain("#1F2937");
    expect(prompt).toContain("#F59E0B");
    expect(prompt).toContain("9:16");
    expect(prompt).toContain("#D9D9D9");
    expect(prompt).toMatch(/top 14%/);
    expect(prompt).toMatch(/headline area/i);
    expect(prompt).toMatch(/no text, letters/i);
    expect(prompt).toContain("Oswald");
    expect(prompt).toContain("Fameseg");
    expect(negative).toMatch(/logos/);
    expect(masterPrompt(brief, "square").prompt).toContain("1:1");
    expect(masterPrompt(brief, "portrait").prompt).toContain("4:5");
  });
  it("la versión corta (Recraft) cabe en 1000 letras y la de estilo pide copiar la referencia", () => {
    const c = masterPrompt({ ...brief, about: "x".repeat(2000) }, "square", { compact: true });
    expect(c.prompt.length).toBeLessThanOrEqual(1000);
    expect(c.prompt).toContain("#BB1111");
    expect(masterPrompt(brief, "portrait", { styleRef: true }).prompt).toMatch(/reference image/);
  });
});

describe("tabla de modelos", () => {
  it("solo los que tienen clave; Ideogram directo esconde al de fal.ai", () => {
    expect(designModels({})).toEqual([]);
    const fal = designModels({ FAL_KEY: "k" }).map((m) => m.id);
    expect(fal).toContain("ideogram-fal");
    expect(fal).not.toContain("ideogram");
    const both = designModels({ FAL_KEY: "k", IDEOGRAM_API_KEY: "i" }).map((m) => m.id);
    expect(both[0]).toBe("ideogram");
    expect(both).not.toContain("ideogram-fal");
    expect(designModels({ IDEOGRAM_API_KEY: "i" }).map((m) => m.id)).toEqual(["ideogram"]);
  });
  it("DESIGN_AI_MODELS cambia el orden, la lista y el precio", () => {
    expect(parseModelList("gpt-image-2:0.3, nope, recraft-v4,gpt-image-2")).toEqual([{ id: "gpt-image-2", usd: 0.3 }, { id: "recraft-v4" }]);
    const list = designModels({ FAL_KEY: "k", DESIGN_AI_MODELS: "recraft-v4,gpt-image-2:0.3" });
    expect(list.map((m) => m.id)).toEqual(["recraft-v4", "gpt-image-2"]);
    expect(list[1].usd.story).toBe(0.3);
  });
  it("tope y costo", () => {
    expect(maxUsd({})).toBe(1);
    expect(maxUsd({ DESIGN_AI_MAX_USD: "2.5" })).toBe(2.5);
    expect(maxUsd({ DESIGN_AI_MAX_USD: "abc" })).toBe(1);
    expect(estimateUsd([model("ideogram"), model("nano-banana-pro")], ["square", "story"])).toBeCloseTo(0.48, 5);
  });
});

describe("pedidos", () => {
  it("Ideogram directo: JSON con paleta, sin magic prompt, estilo de diseño y en segundo plano", () => {
    const { url, init } = ideogramRequest(model("ideogram"), { brief, shape: "portrait" }, "KEY");
    expect(url).toBe("https://api.ideogram.ai/v2/image/generate/ideogram-3");
    expect((init.headers as Record<string, string>)["Api-Key"]).toBe("KEY");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ aspect_ratio: "4x5", rendering_speed: "quality", magic_prompt: "off", style_type: "design", async: true, num_images: 1 });
    expect(body.color_palette.members[0]).toEqual({ color_hex: "#BB1111", color_weight: 0.6 });
    expect(body.negative_prompt).toMatch(/text/);
  });
  it("Ideogram con referencia de estilo: multipart con la imagen", () => {
    const { init } = ideogramRequest(model("ideogram"), { brief, shape: "story" }, "KEY", { data: Buffer.from([1, 2, 3]), type: "image/png" });
    const form = init.body as FormData;
    expect(form.get("aspect_ratio")).toBe("9x16");
    expect(JSON.parse(String(form.get("color_palette"))).members).toHaveLength(3);
    expect(form.get("style_reference_images")).toBeInstanceOf(Blob);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });
  it("fal.ai: cada modelo con sus campos", () => {
    const ideo = falRequest(model("ideogram-fal"), { brief, shape: "square" });
    expect(ideo.input).toMatchObject({ rendering_speed: "QUALITY", style: "DESIGN", expand_prompt: false, image_size: "square_hd" });
    expect((ideo.input.color_palette as { members: { rgb: unknown }[] }).members[0].rgb).toEqual({ r: 187, g: 17, b: 17 });
    const nano = falRequest(model("nano-banana-pro"), { brief, shape: "story", styleRefUrls: ["https://x/a.png"] });
    expect(nano.endpoint).toBe("fal-ai/nano-banana-pro/edit");
    expect(nano.input).toMatchObject({ aspect_ratio: "9:16", image_urls: ["https://x/a.png"] });
    const gpt = falRequest(model("gpt-image-2"), { brief, shape: "portrait" });
    expect(gpt.input.image_size).toEqual({ width: 1024, height: 1280 });
    const rec = falRequest(model("recraft-v4-pro"), { brief, shape: "square", styleRefUrls: ["https://x/a.png"] });
    expect(String(rec.input.prompt).length).toBeLessThanOrEqual(1000);
    expect(rec.input.colors).toHaveLength(3);
    expect(rec.input).not.toHaveProperty("image_urls");
  });
  it("Ideogram directo con fetch simulado: empieza, espera y entrega", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const replies = [
      { status: 200, body: { generation_id: "abc_123", seed: 1 } },
      { status: 200, body: { generation_id: "abc_123", status: "pending" } },
      { status: 200, body: { generation_id: "abc_123", status: "completed", data: [{ url: "https://ideogram.ai/api/images/x.png?exp=1", is_image_safe: true }] } },
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = replies.shift()!;
      return new Response(JSON.stringify(r.body), { status: r.status });
    }));
    const env = { IDEOGRAM_API_KEY: "SECRET" };
    const job = await submitMaster(model("ideogram"), { brief, shape: "square" }, { env });
    expect(job).toEqual({ kind: "ideogram", id: "abc_123" });
    expect(await pollMaster(job, env)).toEqual({ done: false });
    expect(await pollMaster(job, env)).toEqual({ done: true, url: "https://ideogram.ai/api/images/x.png?exp=1" });
    expect(calls[1].url).toBe("https://api.ideogram.ai/v2/generations/abc_123");
    expect((calls[1].init?.headers as Record<string, string>)["Api-Key"]).toBe("SECRET");
  });
  it("Ideogram: errores en palabras simples", async () => {
    const env = { IDEOGRAM_API_KEY: "x" };
    for (const [status, body, re] of [
      [401, "{}", /rechazó la clave/],
      [402, JSON.stringify({ error: "no", reject_reason: "insufficient_funds" }), /no tiene créditos/],
      [422, JSON.stringify({ error: "unsafe" }), /seguridad/],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));
      await expect(submitMaster(model("ideogram"), { brief, shape: "square" }, { env })).rejects.toThrow(re);
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "completed", data: [{ url: "", is_image_safe: false }] }), { status: 200 })));
    await expect(pollMaster({ kind: "ideogram", id: "a" }, env)).rejects.toThrow(/seguridad/);
    await expect(submitMaster(model("ideogram"), { brief, shape: "square" }, { env: {} })).rejects.toThrow(/IDEOGRAM_API_KEY/);
  });
  it("fal.ai con fetch simulado: va a la cola con la clave", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ status_url: "https://queue.fal.run/x/requests/1/status", response_url: "https://queue.fal.run/x/requests/1" }), { status: 200 });
    }));
    vi.stubEnv("FAL_KEY", "FK");
    const job = await submitMaster(model("ideogram-fal"), { brief, shape: "square" }, { env: { FAL_KEY: "FK" } });
    vi.unstubAllEnvs();
    expect(job.kind).toBe("fal");
    expect(calls[0].url).toBe("https://queue.fal.run/fal-ai/ideogram/v3");
    expect(JSON.parse(String(calls[0].init?.body)).rendering_speed).toBe("QUALITY");
  });
});

describe("cajas del diseño", () => {
  it("cleanBox acepta porcentajes y rechaza cajas fuera o diminutas", () => {
    expect(cleanBox({ x: 10, y: 20, w: 50, h: 40 })).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
    expect(cleanBox({ x: 0.9, y: 0.1, w: 0.5, h: 0.5 })).toEqual({ x: 0.9, y: 0.1, w: 0.1, h: 0.5 });
    expect(cleanBox({ x: 0.1, y: 0.1, w: 0.01, h: 0.5 })).toBeNull();
    expect(cleanBox({ x: "a" })).toBeNull();
  });
  it("encuentra la caja gris en los píxeles", () => {
    const w = 50;
    const h = 50;
    const data = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        const inBox = x >= 5 && x < 45 && y >= 4 && y < 30;
        const c = inBox ? [217, 217, 217] : [187, 17, 17];
        data.set(c, i);
      }
    expect(placeholderBox(data, w, h)).toEqual({ x: 0.1, y: 0.08, w: 0.8, h: 0.52 });
    expect(placeholderBox(new Uint8Array(w * h * 3).fill(30), w, h)).toBeNull();
  });
  it("si nada funciona: cajas de siempre y se pide ajustar", () => {
    const a = resolveAreas({ ai: null, pixel: null, shape: "square" });
    expect(a.by).toBe("default");
    expect(a.needsAdjust).toBe(true);
    expect(a.textBox.y).toBeGreaterThan(a.photoBox.y + a.photoBox.h);
    // El logo nunca pisa la foto ni el titular (si no hay rincón libre, el titular le hace lugar).
    for (const shape of ["square", "portrait", "story"] as const) {
      const r = resolveAreas({ ai: null, pixel: null, shape });
      expect(overlap(r.logoBox!, r.photoBox)).toBeLessThan(0.001);
      expect(overlap(r.logoBox!, r.textBox)).toBeLessThan(0.001);
      expect(r.logoBox!.h).toBeGreaterThan(0.04);
    }
  });
  it("usa lo que vio la IA; si el titular pisa la foto, lo mueve", () => {
    const good = resolveAreas({
      ai: { photo: { x: 0.05, y: 0.05, w: 0.9, h: 0.5 }, text: { x: 0.05, y: 0.6, w: 0.9, h: 0.25 }, logo: { x: 0.05, y: 0.88, w: 0.25, h: 0.08 }, photoShape: "rounded", textAlign: "center", textInImage: [] },
      pixel: { x: 0.06, y: 0.05, w: 0.88, h: 0.5 },
      shape: "square",
    });
    expect(good.by).toBe("ai");
    expect(good.needsAdjust).toBe(false);
    expect(good.photoBox.x).toBeCloseTo(0.056, 3);
    expect(good.textAlign).toBe("centro");
    expect(good.photoRadius).toBeGreaterThan(0);
    const bad = resolveAreas({ ai: { photo: { x: 0.05, y: 0.05, w: 0.9, h: 0.6 }, text: { x: 0.1, y: 0.3, w: 0.8, h: 0.3 } }, pixel: null, shape: "portrait" });
    expect(bad.textBox.y).toBeGreaterThanOrEqual(0.65);
    expect(bad.needsAdjust).toBe(true);
  });
  it("color de las letras según el fondo", () => {
    expect(inkFor("#111111", "#bb1111")).toBe("claro");
    expect(inkFor("#ffffff", "#bb1111")).toBe("marca");
    expect(inkFor("#ffffff", "#ffd400")).toBe("oscuro");
  });
});

describe("plantillas propias: compatibles con lo de antes", () => {
  const old: CustomSpec = { imageUrl: "https://x.supabase.co/a.png", w: 1080, h: 1350, mode: "fondo", photo: "izquierda", text: "centro", ink: "claro" };
  it("las guardadas antes se leen igual y usan las mismas cajas", () => {
    const parsed = StoredTemplate.parse(customBase("Mía", old));
    expect(parsed.custom).toEqual(old);
    expect(customFor(parsed.custom!, "story")).toBe(parsed.custom);
    expect(customBoxes(old)).toEqual({ photo: PHOTO_BOXES.izquierda, text: textBox(old), logo: null });
    expect(customBoxes({ ...old, mode: "marco", photo: "completa" }).photo).toBeNull();
    expect(isMaster(parsed)).toBe(false);
  });
  it("las cajas exactas ganan y cada forma usa su variante", () => {
    const m: CustomSpec = { ...old, photoBox: { x: 0.1, y: 0.1, w: 0.8, h: 0.5 }, textBox: { x: 0.1, y: 0.65, w: 0.8, h: 0.2 }, source: "ai-master", variants: { story: { imageUrl: "https://x/s.png", w: 1080, h: 1920, photoBox: { x: 0.05, y: 0.2, w: 0.9, h: 0.4 }, ink: "oscuro" } } };
    expect(customBoxes(m).photo).toEqual(m.photoBox);
    const story = customFor(m, "story");
    expect(story.imageUrl).toBe("https://x/s.png");
    expect(story.textBox).toBeUndefined();
    expect(story.ink).toBe("oscuro");
    expect(customFor(m, "square").imageUrl).toBe(old.imageUrl);
    expect(CustomSpec.safeParse({ ...old, photoBox: { x: 0.5, y: 0, w: 0.8, h: 0.5 } }).success).toBe(false);
  });
  it("en automático, con foto, se usan primero los diseños maestros", () => {
    const master = customBase("Maestro", { ...old, photoBox: { x: 0.1, y: 0.1, w: 0.8, h: 0.5 }, source: "ai-master", preferred: true });
    const other = customBase("Otra", old);
    const list = [other, master];
    expect(pickTemplate(list, -1, { headline: "Hola", hasPhoto: true, seed: 0 }).name).toBe("Maestro");
    expect(pickTemplate(list, -1, { headline: "Hola", hasPhoto: true, seed: 3 }).name).toBe("Maestro");
    expect(pickTemplate(list, 0, { headline: "Hola", hasPhoto: true }).name).toBe("Otra");
    const off = customBase("Apagado", { ...old, source: "ai-master", preferred: false });
    expect(pickTemplate([other, off], -1, { headline: "Hola", hasPhoto: true, seed: 0 }).name).toBe("Otra");
  });
});

describe("dibujo con cajas exactas", () => {
  it("el titular queda dentro de su caja y la foto en la suya", async () => {
    const bg = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#14213d" } }).png().toBuffer();
    const photo = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#22c55e" } }).jpeg().toBuffer();
    const uri = (b: Buffer, t: string) => `data:image/${t};base64,${b.toString("base64")}`;
    const photoBox = { x: 0.1, y: 0.08, w: 0.8, h: 0.48 };
    const tb = { x: 0.12, y: 0.62, w: 0.76, h: 0.22 };
    const custom: CustomSpec = { imageUrl: uri(bg, "png"), w: 1000, h: 1000, mode: "fondo", photo: "arriba", text: "abajo", ink: "claro", photoBox, textBox: tb, source: "ai-master" };
    const jpg = await renderDesign({
      brand: { name: "Fameseg", color: "#bb1111", fontHeading: "montserrat" },
      template: customBase("Maestro", custom),
      headline: "Cortinas metálicas resistentes hechas a la medida de tu negocio en Managua",
      photoUrl: uri(photo, "jpeg"),
      shape: "square",
    });
    const { data, info } = await sharp(jpg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1080, 1080]);
    const W = info.width;
    let whiteIn = 0;
    let whiteOut = 0;
    let greenInPhoto = 0;
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        const fx = x / W;
        const fy = y / info.height;
        const inText = fx >= tb.x - 0.005 && fx <= tb.x + tb.w + 0.005 && fy >= tb.y - 0.005 && fy <= tb.y + tb.h + 0.005;
        const inPhoto = fx >= photoBox.x && fx <= photoBox.x + photoBox.w && fy >= photoBox.y && fy <= photoBox.y + photoBox.h;
        if (r > 200 && g > 200 && b > 200) {
          if (inText) whiteIn++;
          else whiteOut++;
        }
        if (inPhoto && g > 150 && r < 90) greenInPhoto++;
      }
    expect(whiteIn).toBeGreaterThan(2000);
    expect(whiteOut).toBe(0);
    expect(greenInPhoto).toBeGreaterThan(photoBox.w * photoBox.h * W * W * 0.9);
  }, 30000);
});

describe("cajas encontradas en un diseño real (sin Gemini)", () => {
  it("encuentra la caja gris y elige letras claras sobre fondo oscuro", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const { detectAreas } = await import("@/lib/design-ai-run");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#14213d"/><rect x="60" y="60" width="904" height="560" fill="#D9D9D9"/><circle cx="980" cy="980" r="120" fill="#bb1111"/></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const { areas, ink } = await detectAreas(png, "square", "#bb1111");
    vi.unstubAllEnvs();
    expect(areas.by).toBe("pixels");
    expect(areas.photoBox.x).toBeCloseTo(0.054, 1);
    expect(areas.photoBox.y + areas.photoBox.h).toBeCloseTo(0.61, 1);
    expect(areas.textBox.y).toBeGreaterThan(areas.photoBox.y + areas.photoBox.h);
    expect(ink).toBe("claro");
  });
});

describe("logo real en su caja", () => {
  it("se dibuja dentro de logoBox, sobre una placa si no se lee", async () => {
    const uri = (b: Buffer, t: string) => `data:image/${t};base64,${b.toString("base64")}`;
    const bg = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#bb1111" } }).png().toBuffer();
    const logo = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><rect width="400" height="120" fill="#9a1010"/></svg>`)).png().toBuffer();
    const photo = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#22c55e" } }).jpeg().toBuffer();
    const logoBox = { x: 0.7, y: 0.88, w: 0.25, h: 0.08 };
    const custom: CustomSpec = { imageUrl: uri(bg, "png"), w: 1000, h: 1000, mode: "fondo", photo: "arriba", text: "abajo", ink: "claro", photoBox: { x: 0.1, y: 0.1, w: 0.8, h: 0.5 }, textBox: { x: 0.1, y: 0.65, w: 0.8, h: 0.18 }, logoBox, source: "ai-master" };
    const jpg = await renderDesign({ brand: { name: "F", color: "#bb1111", logoUrl: uri(logo, "png") }, template: customBase("M", custom), headline: "Hola", photoUrl: uri(photo, "jpeg"), shape: "square" });
    const { data, info } = await sharp(jpg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let plate = 0;
    let logoPx = 0;
    for (let y = Math.round(0.85 * info.height); y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 3;
        const fx = x / info.width;
        const fy = y / info.height;
        const inBox = fx >= logoBox.x - 0.003 && fx <= logoBox.x + logoBox.w + 0.003 && fy >= logoBox.y - 0.003 && fy <= logoBox.y + logoBox.h + 0.003;
        if (data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235) {
          expect(inBox).toBe(true);
          plate++;
        }
        if (Math.abs(data[i] - 0x9a) < 12 && data[i + 1] < 40 && inBox) logoPx++;
      }
    expect(plate).toBeGreaterThan(300);
    expect(logoPx).toBeGreaterThan(1000);
  }, 30000);
});
