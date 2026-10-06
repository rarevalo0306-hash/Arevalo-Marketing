import { describe, expect, it } from "vitest";
import { readBacklinksReport } from "@/lib/seo/backlinks";
import { buildCannibal } from "@/lib/seo/cannibal";
import { businessTopicVocab, readGapReport, relevantGapRows } from "@/lib/seo/gap";
import { readKeywordsReport } from "@/lib/seo/keywords";
import { readMapReport, type MapReport } from "@/lib/seo/maprank";
import { joinNames, ordinal, pageMismatch, plainSummary, positionText, rankedPageName, rowAdvice, urlPath, verdictOf, type PlainInput } from "@/lib/seo/plain";
import { readRankReport, type RankRow } from "@/lib/seo/rank";
import { marketSummary } from "@/lib/seo/sov";
import { readTrafficReport } from "@/lib/seo/traffic";
import { readVisibilityReport } from "@/lib/seo/visibility";
import fameseg from "./fixtures/fameseg.json";
import { backlinksSaved, cannibalPageQueries, cannibalRange, famesegAiWithTone, mapNow, trafficSaved } from "./fixtures/seo-tools";

// Datos reales de Fameseg (cortinas metálicas y portones, Managua) guardados el 6 de octubre de 2026.
const rank = readRankReport(fameseg.reports.rank.data)!;
const keywords = readKeywordsReport(fameseg.reports.keywords.data)!;
const ai = readVisibilityReport(fameseg.reports.ai.data)!;
const gap = readGapReport(fameseg.reports.gap.data)!;
const vocab = businessTopicVocab(fameseg.business);
const row = (k: string) => rank.rows.find((r) => r.keyword === k)!;
// Tu parte del mercado, como la arma SeoGuide con los últimos reportes guardados.
const market = marketSummary({ website: fameseg.business.website, rankByZone: [[rank]], keywords: [keywords], ai: [ai] });
const base: PlainInput = { businessId: "fameseg", rank, keywords, tracked: fameseg.business.seoKeywords, ai, gap: relevantGapRows(gap.rows, vocab), market };

describe("qué quiere decir cada posición", () => {
  it("veredicto: Excelente, Bien, Casi, Lejos, No sales", () => {
    expect([1, 3, 4, 10, 11, 15, 16, 20, null].map(verdictOf)).toEqual(["excellent", "excellent", "good", "good", "close", "close", "far", "far", "none"]);
  });

  it("la celda en palabras: Google y el mapa", () => {
    expect(positionText(row("cortinas metálicas managua"))).toEqual({
      organic: { es: "2° en Google", en: "#2 on Google" },
      map: { es: "Hay mapa, pero no sales", en: "There's a map, but you're not on it" },
    });
    expect(positionText(row("mantenimiento de cortinas metálicas"))).toEqual({
      organic: { es: "No sales (top 20)", en: "Not in top 20" },
      map: { es: "3° en el mapa", en: "#3 on the map" },
    });
    expect(positionText(row("portones tipo americano nicaragua")).map).toEqual({ es: "Google no mostró mapa", en: "Google showed no map" });
  });

  it("ordinal y nombres juntos", () => {
    expect(ordinal(2)).toEqual({ es: "2°", en: "#2" });
    expect(joinNames(["a", "b", "c", "d", "e"])).toEqual({ es: "«a», «b», «c» y 2 más", en: "“a”, “b”, “c” and 2 more" });
    expect(joinNames(["a"]).es).toBe("«a»");
  });
});

describe("la página que sale trata de otra cosa", () => {
  it("detecta el artículo de equipos de protección personal que sale para «cortinas tubulares managua»", () => {
    const r = row("cortinas tubulares managua");
    expect(rowAdvice(r)).toEqual({ verdict: "good", mismatch: true, page: "Equipos de protección personal: qué necesita su empresa en Nicaragua" });
  });

  it("no marca la página correcta (cortina metálica) ni la página principal", () => {
    expect(rowAdvice(row("cortinas metálicas managua")).mismatch).toBe(false);
    expect(pageMismatch("cortinas metálicas managua", "https://fameseg.com/")).toBe(false);
    expect(pageMismatch("cortinas metálicas managua", null)).toBe(false);
  });

  it("una página de cobertura de Managua no es sobre portones tipo americano (el lugar no cuenta)", () => {
    expect(pageMismatch("portones tipo americano nicaragua", "https://fameseg.com/cobertura/managua")).toBe(true);
    expect(rankedPageName(row("portones tipo americano nicaragua"))).toBe("cobertura/managua");
    expect(pageMismatch("portones tipo americano", "https://fameseg.com/servicios/portones-americanos")).toBe(false);
  });

  it("lee la dirección con acentos y sin terminación", () => {
    expect(urlPath("https://x.com/blog/reparaci%C3%B3n-de-techos.html")).toBe("blog/reparación-de-techos");
    expect(pageMismatch("reparación de techos miami", "https://x.com/blog/reparacion-techo.html")).toBe(false);
  });

  it("no falla con filas sin dirección", () => {
    const r: RankRow = { keyword: "x y z", position: null, url: null, localPack: null, top: [], features: [] };
    expect(rowAdvice(r)).toEqual({ verdict: "none", mismatch: false, page: "" });
  });
});

describe("plainSummary con los datos de Fameseg", () => {
  const lines = plainSummary(base);

  it("arma 6 frases simples: lo que urge, lo que va bien y las oportunidades", () => {
    expect(lines.map((l) => l.text.es)).toEqual([
      "Para «portones automáticos nicaragua» no sales en los primeros 20 resultados: casi nadie te encuentra. Escribe un artículo o crea una página sobre eso.",
      "Para «cortinas metálicas managua» sales 2° en Google: muy bien, casi todos los clics se los llevan los 3 primeros.",
      "En el mapa de Google sales 3° para «mantenimiento de cortinas metálicas» y 3° para «cortinas tubulares managua». El mapa sale arriba de todo: ahí te llaman directo.",
      "ChatGPT te recomienda en 4 de 5 preguntas. Gemini no se pudo revisar (llegó a su límite gratis por minuto): vuelve a intentar en un rato.",
      "Te llevas el 11% de los clics en tus búsquedas; Facebook y otros directorios se llevan el 60%: pon tu negocio bien completo en esos sitios.",
      "Para «cortinas tubulares managua» Google muestra tu página «Equipos de protección personal: qué necesita su empresa en Nicaragua», que no habla específicamente de eso. Una página o artículo sobre «cortinas tubulares managua» te ayudaría a subir.",
    ]);
    expect(lines.map((l) => l.icon)).toEqual(["⚠️", "✅", "📍", "🤖", "📊", "🔀"]);
    expect(lines.map((l) => l.tone)).toEqual(["bad", "good", "good", "good", "warn", "warn"]);
  });

  it("cada frase lleva a su sección y, si hay algo que hacer, al asistente para escribir", () => {
    expect(lines.map((l) => l.link.href)).toEqual(["#posiciones", "#posiciones", "#posiciones", "#ia", "#mercado", "#posiciones"]);
    expect(lines[0].action?.href).toBe("/b/fameseg/seo/escribir?kw=portones%20autom%C3%A1ticos%20nicaragua");
    expect(lines[5].action?.href).toBe("/b/fameseg/seo/escribir?kw=cortinas%20tubulares%20managua");
  });

  it("también en inglés", () => {
    expect(lines[1].text.en).toBe("For “cortinas metálicas managua” you're #2 on Google: great, the top 3 get almost all the clicks.");
    expect(lines[3].text.en).toBe("ChatGPT recommends you in 4 of 5 questions. Gemini couldn't be checked (it hit its free per-minute limit): try again in a while.");
    expect(lines[4].text.en).toBe("You get 11% of the clicks on your searches; Facebook and other directories get 60%: make sure your business is fully listed on those sites.");
  });

  it("con más espacio agrega la segunda página, la oportunidad de la competencia (solo las del negocio) y las palabras sin búsquedas", () => {
    const all = plainSummary({ ...base, max: 20 });
    const extra = all.slice(6).map((l) => l.text.es);
    expect(extra).toEqual([
      "Para «portones tipo americano nicaragua» sales 15°, en la segunda página de Google: casi nadie llega ahí. Mejora esa página o escribe un artículo para pasar a la primera.",
      "Tu competencia sale en Google por «portones corredizos» (320 búsquedas al mes) y tú no: es tu mejor oportunidad para escribir.",
      "Para «cortinas metálicas managua» y «portones automáticos nicaragua» Google muestra un mapa con 3 negocios y tú no estás. Completa tu Perfil de Google y pide reseñas a tus clientes.",
      "3 de tus 5 palabras clave casi no se buscan en Google (menos de unas 10 veces al mes, por eso salen con «—»). Sigue también alguna de las ideas que sí se buscan.",
    ]);
    // Sin el filtro de relevancia, la "mejor oportunidad" sería «gas cerca de mí» (de Páginas Amarillas).
    expect(gap.rows[0].keyword).toBe("gas cerca de mí");
  });

  it("sin tu parte del mercado (reportes viejos) no agrega esa frase", () => {
    expect(plainSummary({ ...base, market: null, max: 20 }).some((l) => l.id.startsWith("share"))).toBe(false);
  });

  it("una IA que solo tuvo errores no cuenta como 0 %", () => {
    expect(ai.byProvider.gemini).toEqual({ score: null, mentioned: 0, total: 0, errors: 5 });
    expect(ai.score).toBe(80);
  });

  it("sin posiciones pide empezar por ahí; sin nada, no inventa", () => {
    expect(plainSummary({ businessId: "x", rank: null })[0].id).toBe("no-rank");
    expect(plainSummary({ businessId: "x", rank: { ...rank, rows: [] } })).toEqual([]);
  });

  it("varias palabras en el top 3 van en una sola frase", () => {
    const r = { ...rank, rows: rank.rows.map((x) => (x.keyword === "portones automáticos nicaragua" ? { ...x, position: 1 } : x)) };
    const first = plainSummary({ businessId: "x", rank: r })[0];
    expect(first.text.es).toBe("Para «portones automáticos nicaragua» y «cortinas metálicas managua» sales entre los 3 primeros de Google: muy bien, casi todos los clics se los llevan los 3 primeros.");
  });
});

describe("veredicto con el mapa", () => {
  it("fuera de la primera página pero entre los 3 del mapa es «Bien en el mapa»", () => {
    expect(verdictOf(null, 3)).toBe("map");
    expect(verdictOf(15, 2)).toBe("map");
    expect(verdictOf(4, 2)).toBe("good");
    expect(verdictOf(null, null)).toBe("none");
    expect(verdictOf(null, 5)).toBe("none");
  });
});

describe("plainSummary con las herramientas nuevas (datos de ejemplo)", () => {
  const toned = readVisibilityReport(famesegAiWithTone())!;
  const cannibal = buildCannibal({ businessName: "Fameseg", website: fameseg.business.website, gsc: { pageQueries: cannibalPageQueries, range: cannibalRange }, ranks: [], audit: null });
  const backlinks = readBacklinksReport(backlinksSaved)!;
  const traffic = readTrafficReport(trafficSaved)!;
  const lines = plainSummary({ ...base, ai: toned, cannibal, backlinks, traffic, max: 20 });
  const text = (id: string) => lines.find((l) => l.id === id)?.text;

  it("lo urgente va primero: no sales, una IA habla mal de ti y páginas que compiten; el máximo sigue en 6", () => {
    expect(lines.slice(0, 4).map((l) => l.id)).toEqual(["missing", "sentiment-bad", "cannibal", "top3"]);
    expect(plainSummary({ ...base, ai: toned, cannibal, backlinks, traffic })).toHaveLength(6);
  });

  it("avisa cuando una IA habla mal de ti, con cuál y por qué", () => {
    const l = lines.find((x) => x.id === "sentiment-bad")!;
    expect(l.text.es).toBe(
      "Ojo: las IAs hablan mal de ti en 1 de 4 menciones (ChatGPT: Dice que algunos clientes se quejan de demoras en la instalación). Mira qué dicen y responde a eso en tu página y tus reseñas.",
    );
    expect(l.text.en).toContain("Heads up: the AIs speak badly of you in 1 of 4 mentions (ChatGPT:");
    expect(l.tone).toBe("bad");
    expect(l.link.href).toBe("#ia");
  });

  it("si todas hablan bien, lo dice entre lo que va bien", () => {
    const good = readVisibilityReport(famesegAiWithTone(["positiva", "positiva", "neutral", "positiva"]))!;
    const l = plainSummary({ ...base, ai: good, max: 20 }).find((x) => x.id === "sentiment-good")!;
    expect(l.text.es).toBe("Las IAs hablan bien de ti en 3 de 4 menciones (te asocian con «garantía» y «puntualidad»).");
    expect(l.text.en).toBe("The AIs speak well of you in 3 of 4 mentions (they link you with “garantía” and “puntualidad”).");
    // Sin tono leído (reportes viejos, como el de Fameseg), nada.
    expect(plainSummary({ ...base, max: 20 }).some((x) => x.id.startsWith("sentiment"))).toBe(false);
  });

  it("páginas que compiten: solo si hay una urgente", () => {
    expect(text("cannibal")?.es).toBe("Para «cortinas metalicas» 2 de tus páginas compiten entre sí en Google y se reparten las visitas. Deja una sola como la principal.");
    expect(lines.find((l) => l.id === "cannibal")?.link.href).toBe("#canibalizacion");
    const mild = { ...cannibal, issues: cannibal.issues.filter((i) => i.severity !== "alta") };
    expect(mild.issues.length).toBeGreaterThan(0);
    expect(plainSummary({ ...base, cannibal: mild, max: 20 }).some((l) => l.id === "cannibal")).toBe(false);
  });

  it("enlaces: cuántos sitios te enlazan y dónde tiene enlace tu competencia y tú no", () => {
    expect(text("links")?.es).toBe("12 sitios te enlazan; hay 8 donde tu competencia tiene enlace y tú no: empieza por paginasamarillas.com.ni, que es fácil.");
    expect(text("links")?.en).toBe("12 sites link to you; there are 8 sites where your competitors have a link and you don't: start with paginasamarillas.com.ni, it's easy.");
    const none = readBacklinksReport({ ...backlinksSaved, gap: [] })!;
    expect(plainSummary({ ...base, backlinks: none, max: 20 }).find((l) => l.id === "links")?.text.es).toBe("12 sitios te enlazan.");
  });

  it("visitas: tú contra el competidor que más recibe", () => {
    expect(text("traffic")?.es).toBe("Cormetal recibe unas 45 visitas al mes desde Google y tú 3; mira qué páginas le funcionan.");
    expect(text("traffic")?.en).toBe("Cormetal gets about 45 visits a month from Google and you get 3; see which pages work for them.");
    const ahead = readTrafficReport({ ...trafficSaved, domains: trafficSaved.domains.map((d) => (d.isYou ? { ...d, history: [{ month: "2026-09", etv: 80 }] } : d)) })!;
    expect(plainSummary({ ...base, traffic: ahead, max: 20 }).find((l) => l.id === "traffic")?.text.es).toBe("Recibes unas 80 visitas al mes desde Google, más que tu competencia.");
  });

  it("tu parte: si llevas la delantera va entre lo que va bien; sin posiciones usa el mapa", () => {
    const lead = { ...market, organic: { ...market.organic!, directories: 0.05 } };
    const l = plainSummary({ ...base, market: lead, max: 20 }).find((x) => x.id.startsWith("share"))!;
    expect(l.id).toBe("share-good");
    expect(l.text.es).toBe("Te llevas el 11% de los clics posibles en tus búsquedas: más que cualquier competidor.");
    const map = marketSummary({ website: "", maps: [[readMapReport(mapNow) as MapReport]] });
    const m = plainSummary({ businessId: "x", rank: null, canRank: false, market: map }).find((x) => x.id.startsWith("share"))!;
    expect(m.text.es).toBe("Sales entre los 3 primeros en el 50% del mapa; CortyPort Industrial en el 100%.");
  });

  it("sin datos de las herramientas nuevas no agrega nada (y no falla con reportes rotos)", () => {
    const plain = plainSummary({ ...base, market: null, max: 20 }).map((l) => l.id);
    expect(plain).not.toContain("links");
    expect(plain).not.toContain("traffic");
    const broken = plainSummary({ ...base, backlinks: readBacklinksReport({ domain: "fameseg.com", summary: {} }), traffic: readTrafficReport({ domains: [{ domain: "x.com" }] }), max: 20 });
    expect(broken.some((l) => l.id === "links" || l.id === "traffic")).toBe(false);
  });
});
