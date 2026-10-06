import { describe, expect, it } from "vitest";
import type { AuditReport } from "@/lib/seo/audit";
import { businessTopicVocab } from "@/lib/seo/gap";
import {
  answeredBy,
  answers,
  articleQuestions,
  articleTexts,
  buildQuestions,
  rankQuestions,
  rankRelated,
  siteTexts,
  topicWords,
  writerTopic,
  type AnswerText,
} from "@/lib/seo/questions";
import { parseSerp, readRankReport, serpQuestions, serpRelated, type RankReport, type SerpResult } from "@/lib/seo/rank";
import { readArticleReport, type ArticleReport } from "@/lib/seo/writer";
import fameseg from "./fixtures/fameseg.json";

const vocab = businessTopicVocab(fameseg.business as Parameters<typeof businessTopicVocab>[0]);

/** Respuesta de DataForSEO (organic/live/advanced) para «cortinas metálicas managua», con la forma de la documentación. */
const SERP = {
  keyword: "cortinas metálicas managua",
  item_types: ["local_pack", "organic", "people_also_ask", "related_searches"],
  items: [
    { type: "local_pack", rank_group: 1, rank_absolute: 1, title: "Fameseg", domain: "fameseg.com" },
    { type: "organic", rank_group: 1, rank_absolute: 2, domain: "www.facebook.com", url: "https://www.facebook.com/cortyportinds/", title: "CortyPort Industrial - Cortinas Metalicas Enrollables | Managua" },
    {
      type: "organic",
      rank_group: 2,
      rank_absolute: 3,
      domain: "fameseg.com",
      url: "https://fameseg.com/blog/cuanto-cuesta-una-cortina-metalica-en-nicaragua",
      title: "¿Cuánto cuesta una cortina metálica en Nicaragua? Lo que define el precio",
    },
    {
      type: "people_also_ask",
      rank_group: 1,
      rank_absolute: 4,
      items: [
        {
          type: "people_also_ask_element",
          title: "¿Cuánto cuesta una cortina metálica en Nicaragua?",
          seed_question: null,
          expanded_element: [{ type: "people_also_ask_expanded_element", title: "Precios de cortinas", url: "https://x.com" }],
        },
        { type: "people_also_ask_element", title: "¿Qué es una cortina metálica?" },
        { type: "people_also_ask_element", title: "¿Cuánto dura una cortina metálica enrollable?" },
        { type: "people_also_ask_element", title: "¿CUANTO CUESTA una cortina metalica en Nicaragua" },
        { type: "people_also_ask_element", title: "  " },
        { type: "people_also_ask_element", title: "¿Cuánto cuesta el gas butano en Managua?" },
      ],
    },
    { type: "organic", rank_group: 3, rank_absolute: 5, domain: "paginasamarillas.com.ni", url: "https://www.paginasamarillas.com.ni/servicios/cortinas-metalicas", title: "Cortinas Metalicas en Nicaragua" },
    {
      type: "related_searches",
      rank_group: 1,
      rank_absolute: 6,
      items: ["cortinas metálicas precio nicaragua", "Cortinas metalicas precio Nicaragua", "cortinas tubulares", "gasolineras managua", "cortinas metálicas managua"],
    },
  ],
} as unknown as SerpResult;

describe("rank.ts: preguntas y búsquedas relacionadas", () => {
  it("lee las preguntas de people_also_ask_element.title, sin repetir (acentos/mayúsculas/signos) y sin vacías", () => {
    expect(serpQuestions(SERP.items ?? [])).toEqual([
      "¿Cuánto cuesta una cortina metálica en Nicaragua?",
      "¿Qué es una cortina metálica?",
      "¿Cuánto dura una cortina metálica enrollable?",
      "¿Cuánto cuesta el gas butano en Managua?",
    ]);
    expect(serpRelated(SERP.items ?? [])).toEqual(["cortinas metálicas precio nicaragua", "cortinas tubulares", "gasolineras managua", "cortinas metálicas managua"]);
  });
  it("máximo 8 de cada una", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ type: "people_also_ask_element", title: `¿Pregunta ${i}?` }));
    expect(serpQuestions([{ type: "people_also_ask", items: many } as never])).toHaveLength(8);
    expect(serpRelated([{ type: "related_searches", items: many.map((m) => m.title) } as never])).toHaveLength(8);
  });
  it("parseSerp guarda questions y related (vacías si Google no las mostró) y readRankReport las lee", () => {
    const row = parseSerp("cortinas metálicas managua", SERP, "fameseg.com", "Fameseg");
    expect(row.position).toBe(2);
    expect(row.questions).toHaveLength(4);
    expect(row.related).toHaveLength(4);
    expect(row.features).toContain("people_also_ask");
    const none = parseSerp("x", { items: [] }, "fameseg.com", "Fameseg");
    expect(none.questions).toEqual([]);
    const back = readRankReport({ rows: [row, none, { keyword: "vieja", position: 3, top: [], features: [] }] });
    expect(back!.rows[0].questions).toEqual(row.questions);
    expect(back!.rows[1].questions).toEqual([]);
    // Las revisiones viejas no tienen el campo.
    expect(back!.rows[2].questions).toBeUndefined();
    expect(back!.rows[2].related).toBeUndefined();
  });
  it("readRankReport ignora basura en questions", () => {
    const back = readRankReport({ rows: [{ keyword: "a", position: null, questions: ["¿Uno?", 3, null, "¿uno?"], related: "no" }] });
    expect(back!.rows[0].questions).toEqual(["¿Uno?"]);
    expect(back!.rows[0].related).toBeUndefined();
  });
});

describe("¿la pregunta ya se responde?", () => {
  it("el título del blog de Fameseg responde la pregunta del precio", () => {
    expect(answers("¿Cuánto cuesta una cortina metálica en Nicaragua? Lo que define el precio", "¿Cuánto cuesta una cortina metálica en Managua?")).toBe(true);
    expect(answers("Precio de cortinas metálicas en Nicaragua", "¿Cuánto cuesta una cortina metálica en Nicaragua?")).toBe(true);
  });
  it("el título de la página de inicio no responde una pregunta corta («¿Qué es…?»)", () => {
    expect(answers("Cortinas metálicas en Managua | Fameseg", "¿Qué es una cortina metálica?")).toBe(false);
    expect(answers("¿Qué es una cortina metálica y para qué sirve?", "¿Qué es una cortina metálica?")).toBe(true);
  });
  it("no confunde temas distintos", () => {
    expect(answers("Equipos de protección personal: qué necesita su empresa en Nicaragua", "¿Cuánto cuesta una cortina metálica en Nicaragua?")).toBe(false);
    expect(answers("Mantenimiento de cortinas metálicas", "¿Cada cuánto se le da mantenimiento a una cortina metálica?")).toBe(true);
    expect(answers("Portones tipo americano", "¿Cuánto dura una cortina metálica enrollable?")).toBe(false);
  });
  it("prefiere la web a un artículo guardado", () => {
    const texts: AnswerText[] = [
      { text: "¿Cuánto cuesta una cortina metálica?", where: "article", label: "Artículo", articleId: "a1" },
      { text: "Precio de cortinas metálicas en Nicaragua", where: "site", label: "Precios", url: "https://fameseg.com/precios" },
    ];
    expect(answeredBy("¿Cuánto cuesta una cortina metálica?", texts)?.where).toBe("site");
    expect(answeredBy("¿Qué motor es mejor para un portón corredizo?", texts)).toBeNull();
  });
});

const rankReport = (): RankReport => {
  const base = readRankReport(fameseg.reports.rank.data)!;
  const serpRow = parseSerp("cortinas metálicas managua", SERP, "fameseg.com", "Fameseg");
  return {
    ...base,
    rows: base.rows.map((r) =>
      r.keyword === "cortinas metálicas managua"
        ? { ...r, questions: serpRow.questions, related: serpRow.related }
        : r.keyword === "mantenimiento de cortinas metálicas"
          ? {
              ...r,
              questions: ["¿Cada cuánto se le da mantenimiento a una cortina metálica?", "¿Cómo engrasar una cortina metálica?", "¿cuánto cuesta una cortina metálica en nicaragua"],
              related: [],
            }
          : r.keyword === "portones tipo americano nicaragua"
            ? { ...r, questions: ["¿Qué es un portón tipo americano?", "¿Cuánto cuesta un portón tipo americano en Nicaragua?", "¿Qué es el Seguro Social en Nicaragua?"] }
            : r,
    ),
  };
};

const article = (): { id: string; report: ArticleReport } => ({
  id: "art1",
  report: readArticleReport({
    keyword: "motores para portones",
    language: "es",
    zone: { code: 2558, name: "Nicaragua" },
    research: { questions: ["¿Qué motor es mejor para un portón corredizo?", "¿Cuánto cuesta un motor para portón en Nicaragua?"] },
    draft: {
      title: "Motores para portones en Nicaragua: cómo elegir",
      h1: "Motores para portones automáticos",
      markdown: "Intro.\n\n## ¿Qué motor es mejor para un portón corredizo?\n\nDepende del peso.\n\n**¿Cuánto cuesta instalar un motor?**\n\nVaría.",
    },
    score: 80,
  })!,
});

describe("buildQuestions con datos de Fameseg", () => {
  const rank = [rankReport()];
  const audit = {
    pages: [
      { url: "https://fameseg.com/", finalUrl: "https://fameseg.com/", status: 200, title: "Cortinas metálicas en Managua | Fameseg", h1: "Cortinas metálicas y portones automáticos" },
      { url: "https://fameseg.com/rota", finalUrl: "https://fameseg.com/rota", status: 404, title: "¿Qué es un portón tipo americano?", h1: "" },
      { url: "https://fameseg.com/mantenimiento", finalUrl: "https://fameseg.com/mantenimiento", status: 200, title: "Mantenimiento de cortinas metálicas en Managua", h1: "Mantenimiento de cortinas metálicas" },
    ],
  } as unknown as AuditReport;
  const site = siteTexts({ audit, rank, domain: "https://fameseg.com" });
  const art = article();
  const data = buildQuestions({
    raw: [...rankQuestions(rank), ...articleQuestions([art])],
    vocab,
    texts: [...site, ...articleTexts([art])],
    related: rankRelated(rank),
  });
  const all = data.groups.flatMap((g) => g.questions);
  const find = (q: string) => all.find((x) => x.question.startsWith(q));

  it("los textos de la web: título y H1 de la auditoría (sin páginas rotas) y las páginas propias en Google", () => {
    expect(site.some((t) => t.text === "Mantenimiento de cortinas metálicas")).toBe(true);
    expect(site.some((t) => t.url === "https://fameseg.com/rota")).toBe(false);
    expect(site.some((t) => t.url === "https://fameseg.com/blog/cuanto-cuesta-una-cortina-metalica-en-nicaragua")).toBe(true);
    expect(site.some((t) => t.text.includes("CortyPort"))).toBe(false);
  });
  it("agrupa por palabra clave en orden y no repite preguntas entre palabras clave", () => {
    expect(data.groups.map((g) => g.keyword)).toEqual(["cortinas metálicas managua", "mantenimiento de cortinas metálicas", "portones tipo americano nicaragua", "motores para portones"]);
    const precio = all.filter((q) => q.question.toLowerCase().includes("cuesta una cortina"));
    expect(precio).toHaveLength(1);
    expect(precio[0].keywords).toEqual(["cortinas metálicas managua", "mantenimiento de cortinas metálicas"]);
  });
  it("oculta lo que no tiene que ver con cortinas y portones", () => {
    expect(find("¿Cuánto cuesta el gas")).toBeUndefined();
    expect(find("¿Qué es el Seguro Social")).toBeUndefined();
    expect(data.hidden).toBe(2);
  });
  it("marca lo que ya responde la web o un artículo", () => {
    expect(find("¿Cuánto cuesta una cortina")?.answered).toMatchObject({ where: "site", url: "https://fameseg.com/blog/cuanto-cuesta-una-cortina-metalica-en-nicaragua" });
    expect(find("¿Cada cuánto")?.answered).toMatchObject({ where: "site", url: "https://fameseg.com/mantenimiento" });
    expect(find("¿Qué es una cortina metálica")?.answered).toBeNull();
    // La página que la respondía da 404: no cuenta.
    expect(find("¿Qué es un portón tipo americano")?.answered).toBeNull();
    expect(find("¿Qué motor es mejor")?.answered).toMatchObject({ where: "article", articleId: "art1" });
    expect(find("¿Cuánto cuesta un motor")?.answered).toBeNull();
    expect(data.total).toBe(all.length);
    expect(data.unanswered + data.answeredSite + data.answeredArticle).toBe(data.total);
  });
  it("las que nadie responde van primero en cada grupo", () => {
    const g = data.groups[0].questions.map((q) => !!q.answered);
    expect(g).toEqual([...g].sort((a, b) => Number(a) - Number(b)));
  });
  it("las búsquedas relacionadas: solo del tema y sin la misma palabra clave", () => {
    expect(data.groups[0].related).toEqual(["cortinas metálicas precio nicaragua", "cortinas tubulares"]);
  });
  it("el tema para el escritor: la pregunta sin signos, o la palabra clave si la pregunta no dice el tema", () => {
    expect(find("¿Qué es una cortina metálica")?.topic).toBe("Qué es una cortina metálica");
    expect(topicWords("¿Cuánto cuesta?")).toEqual([]);
    expect(writerTopic("¿Cuánto cuesta?", "cortinas tubulares managua")).toBe("cortinas tubulares managua");
  });
  it("sin vocabulario no oculta nada; sin datos devuelve vacío", () => {
    expect(buildQuestions({ raw: rankQuestions(rank), vocab: [], texts: [] }).hidden).toBe(0);
    expect(buildQuestions({ raw: [], vocab, texts: [] })).toMatchObject({ groups: [], total: 0, unanswered: 0, hidden: 0 });
  });
});
