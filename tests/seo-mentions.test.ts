import { describe, expect, it } from "vitest";
import { contentDate, htmlLinksTo, markLinked, type Mention, mentionQuery, mentionsSummary, parseMentions, readMentionsReport, sentimentOf, sortMentions, verifyLinks } from "@/lib/seo/mentions";

const RES = [
  {
    total_count: 3,
    items: [
      { type: "content_analysis_search", url: "https://news.example.com/joes-roofing-helps", domain: "news.example.com", main_domain: "example.com", domain_rank: 512, page_types: ["news"], content_info: { title: "Joe's Roofing helps after storm", snippet: "Local company Joe's Roofing…", date_published: "2026-10-01 10:00:00 +00:00", connotation_types: { positive: 0.8, negative: 0.1, neutral: 0.1 } } },
      { url: "https://joesroofing.com/blog", main_domain: "joesroofing.com", content_info: { title: "Our blog" } },
      { url: "https://forum.site.org/t/1", main_domain: "site.org", page_types: ["message-boards"], domain_rank: "120", content_info: { main_title: "Bad experience with Joe's Roofing", date_published: null, connotation_types: { positive: 0.1, negative: 0.7, neutral: 0.2 } } },
      { url: "https://news.example.com/joes-roofing-helps" },
      { url: "javascript:alert(1)", main_domain: "x.com" },
    ],
  },
];

const m = (url: string, domain: string, extra: Partial<Mention> = {}): Mention => ({ url, domain, title: "", snippet: "", date: null, sentiment: null, pageType: "", rank: null, linked: null, ...extra });

describe("Quién habla de ti", () => {
  it("arma la búsqueda exacta del nombre", () => {
    expect(mentionQuery("Joe's Roofing LLC")).toBe('"Joe\'s Roofing"');
    expect(mentionQuery('  "Ricardo Public Adjusters, Inc."  ')).toBe('"Ricardo Public Adjusters"');
    expect(mentionQuery("")).toBe("");
  });

  it("lee las menciones sin tu página ni direcciones repetidas o raras", () => {
    const { total, mentions } = parseMentions(RES, "joesroofing.com");
    expect(total).toBe(3);
    expect(mentions.map((x) => [x.domain, x.title, x.sentiment, x.pageType, x.rank, x.date])).toEqual([
      ["example.com", "Joe's Roofing helps after storm", "positive", "news", 512, "2026-10-01T10:00:00.000Z"],
      ["site.org", "Bad experience with Joe's Roofing", "negative", "message-boards", 120, null],
    ]);
    expect(sentimentOf({})).toBeNull();
    expect(contentDate("nada")).toBeNull();
  });

  it("sabe si una página enlaza a tu sitio", () => {
    expect(htmlLinksTo('<p>Mira <a class="x" href="https://www.joesroofing.com/contacto">aquí</a></p>', "joesroofing.com")).toBe(true);
    expect(htmlLinksTo("<a href='//blog.joesroofing.com'>blog</a>", "joesroofing.com")).toBe(true);
    expect(htmlLinksTo('<a href="https://notjoesroofing.com">x</a> joesroofing.com en texto', "joesroofing.com")).toBe(false);
  });

  it("marca cuáles te enlazan: abriendo las más nuevas y, si no se pudo, con el reporte de enlaces", async () => {
    const list = markLinked([m("https://a.com/1", "a.com"), m("https://b.com/1", "b.com"), m("https://c.com/1", "c.com")], ["b.com"]);
    expect(list.map((x) => x.linked)).toEqual([false, true, false]);
    expect(markLinked([m("https://a.com/1", "a.com")], null)[0].linked).toBeNull();
    const fetchHtml = async (url: string) => {
      if (url.includes("a.com")) return '<a href="https://mio.com">mio</a>';
      if (url.includes("b.com")) throw new Error("timeout");
      return "<p>sin enlace</p>";
    };
    const checked = await verifyLinks(list, "mio.com", fetchHtml, 2);
    // a.com: sí enlaza; b.com: no se pudo abrir, queda lo del reporte; c.com: no se revisó (pasa el máximo).
    expect(checked.map((x) => x.linked)).toEqual([true, true, false]);
  });

  it("ordena, resume y guarda", () => {
    const list = [m("https://a.com/1", "a.com", { date: "2026-01-01T00:00:00.000Z", linked: false }), m("https://b.com/1", "b.com", { date: "2026-09-01T00:00:00.000Z", sentiment: "negative" }), m("https://c.com/1", "c.com", { sentiment: "positive", linked: true })];
    expect(sortMentions(list).map((x) => x.domain)).toEqual(["b.com", "a.com", "c.com"]);
    expect(mentionsSummary(list)).toEqual({ total: 3, negative: 1, unlinked: 1, positive: 1 });
    const r = { query: '"Joe"', total: 3, mentions: list, backlinksChecked: true, notes: [], cost: 0.021, createdAt: "2026-10-14T00:00:00.000Z" };
    expect(readMentionsReport(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(readMentionsReport({ mentions: [{ url: "ftp://x", domain: "x.com" }], createdAt: "x" })?.mentions).toEqual([]);
  });
});
