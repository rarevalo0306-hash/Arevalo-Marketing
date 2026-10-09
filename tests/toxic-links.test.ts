// «Enlaces dañinos»: leer listas de Semrush/Ahrefs/Search Console, clasificar el riesgo con razones, la lista blanca
// (nunca el sitio propio ni plataformas grandes), detectar un ataque, el archivo para Google y las dos preguntas.
import { describe, expect, it } from "vitest";
import { bulkSpamCostEstimate, toxicFetchCostEstimate } from "@/lib/seo/backlinks";
import {
  baselineFromBacklinks,
  buildDisavowFile,
  bulkCommercialAnchors,
  classifyAll,
  classifyDomain,
  decodeExport,
  detectSpike,
  disavowFileName,
  domainOf,
  isCommercialAnchor,
  isNewDomain,
  mergeLinkLists,
  parseBulkSpam,
  parseLinkList,
  parseOwnSites,
  parseToxicFetch,
  readDecision,
  readDisavowFile,
  readToxicAudit,
  safeReason,
  splitCsvLine,
  toxicAlert,
  wizardOutcome,
  type LinkDomain,
  type ToxicAudit,
  type ToxicCtx,
} from "@/lib/toxic-links";

const ctx: ToxicCtx = {
  site: "https://www.ricardopa.com",
  ownSites: ["ricardopa-seguros.com"],
  name: "Ricardo PA",
  vocab: ["ajustador", "publico", "seguro", "reclamo", "florida", "miami", "dano", "agua", "huracan", "insurance", "claim", "adjuster", "public"],
  language: "es",
};

const dom = (domain: string, extra: Partial<LinkDomain> = {}): LinkDomain => ({
  domain,
  spamScore: null,
  toolScore: null,
  rank: null,
  backlinks: null,
  firstSeen: null,
  dofollow: null,
  anchors: [],
  url: null,
  externalLinks: null,
  footer: false,
  language: null,
  ...extra,
});

const NOW = new Date("2026-10-09T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400_000).toISOString();

describe("leer listas importadas", () => {
  it("Semrush (Backlink Audit): Source url, anchor y Toxicity Score; junta por dominio", () => {
    const csv = [
      "Source title,Source url,Target url,Anchor,Toxicity Score,Toxic markers,First seen,Last seen,Nofollow",
      'Best Casino,https://best-casino-bonus.xyz/page1,https://ricardopa.com/,"casino, bonus",87,"Link Network",2026-09-20,2026-10-01,FALSE',
      "Best Casino 2,https://best-casino-bonus.xyz/page2,https://ricardopa.com/,ajustador publico miami,80,,2026-09-21,2026-10-01,FALSE",
      "Blog,http://www.spammy-site.top/x,https://ricardopa.com/blog,click here,55,,2025-01-10,2026-10-01,TRUE",
      ",,,,,,,,",
    ].join("\n");
    const r = parseLinkList(csv);
    expect(r.format).toBe("semrush");
    expect(r.items.map((i) => i.domain)).toEqual(["best-casino-bonus.xyz", "spammy-site.top"]);
    const casino = r.items[0];
    expect(casino.toolScore).toBe(87);
    expect(casino.backlinks).toBe(2);
    expect(casino.anchors).toEqual(["casino, bonus", "ajustador publico miami"]);
    expect(casino.url).toBe("https://best-casino-bonus.xyz/page1");
    expect(casino.firstSeen?.slice(0, 10)).toBe("2026-09-20");
    expect(casino.dofollow).toBe(true); // Nofollow = FALSE
    expect(r.items[1].dofollow).toBe(false); // Nofollow = TRUE
  });

  it("Ahrefs: archivo UTF-16 con tabulaciones y Domain rating → fuerza aproximada", () => {
    const tsv = ["Referring page title\tReferring page URL\tDomain rating\tAnchor\tFirst seen", "Hola\thttps://foro.ejemplo-spam.ru/t/1\t3\tseguros baratos\t2026-10-01T10:00:00Z"].join("\r\n");
    const bytes = new Uint8Array([0xff, 0xfe, ...Array.from(tsv).flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
    const text = decodeExport(bytes);
    const r = parseLinkList(text);
    expect(r.format).toBe("ahrefs");
    expect(r.items).toHaveLength(1);
    expect(r.items[0].domain).toBe("foro.ejemplo-spam.ru");
    expect(r.items[0].rank).toBe(30);
    expect(r.items[0].anchors).toEqual(["seguros baratos"]);
  });

  it("Search Console (Top linking sites) con BOM", () => {
    const r = parseLinkList("﻿Site,Linking pages,Target pages\nexample-dir.com,12,3\nwww.Otro-Sitio.net,1,1\n");
    expect(r.format).toBe("gsc");
    expect(r.items.map((i) => i.domain)).toEqual(["example-dir.com", "otro-sitio.net"]);
  });

  it("archivo de desautorización y lista simple: comentarios, domain:, direcciones, basura", () => {
    const r = parseLinkList("# viejo archivo\ndomain:spam1.xyz\nhttps://spam2.top/pagina?a=1\nesto no es un dominio\n*.spam3.icu\nspam1.xyz\nnick.blogspot.com, otra.wordpress.com\n");
    expect(r.format).toBe("disavow");
    expect(r.items.map((i) => i.domain)).toEqual(["spam1.xyz", "spam2.top", "spam3.icu", "nick.blogspot.com", "otra.wordpress.com"]);
    expect(r.skipped).toBe(1);
    expect(readDisavowFile("domain:a-spam.xyz\n# x\ndomain:b-spam.top")).toEqual(["a-spam.xyz", "b-spam.top"]);
  });

  it("CSV con comillas y separador ;", () => {
    expect(splitCsvLine('"a; b";c;"d ""x"""', ";")).toEqual(["a; b", "c", 'd "x"']);
    const r = parseLinkList('Domain;Spam score\n"spam-one.xyz";71\nspam-two.top;12');
    expect(r.items.map((i) => [i.domain, i.spamScore])).toEqual([
      ["spam-one.xyz", 71],
      ["spam-two.top", 12],
    ]);
  });

  it("domainOf y parseOwnSites", () => {
    expect(domainOf("https://www.Ejemplo.com/x")).toBe("ejemplo.com");
    expect(domainOf("domain:spam.xyz")).toBe("spam.xyz");
    expect(domainOf("hola mundo")).toBeNull();
    expect(parseOwnSites("miotro.com, https://socio.com.ni/x\nmiotro.com basura")).toEqual(["miotro.com", "socio.com.ni"]);
  });
});

describe("respuestas de DataForSEO", () => {
  it("junta referring_domains con one_per_domain (texto, idioma, enlaces externos, pie de página)", () => {
    const referring = [
      {
        total_count: 812,
        items: [
          { domain: "spam-links.xyz", rank: 2, backlinks: 340, first_seen: "2026-10-01 10:00:00 +00:00", backlinks_spam_score: 88, referring_links_attributes: null, referring_links_semantic_locations: { footer: 300, article: 40 } },
          { domain: "www.buen-blog.com", rank: 320, backlinks: 2, first_seen: "2020-01-18 11:50:58 +00:00", backlinks_spam_score: 5, referring_links_attributes: { nofollow: 2 } },
        ],
      },
    ];
    const backlinks = [{ items: [{ domain_from: "spam-links.xyz", url_from: "https://spam-links.xyz/p", anchor: "ajustador publico miami", page_from_external_links: 220, page_from_language: "ru", semantic_location: "footer", dofollow: true, backlink_spam_score: 90 }] }];
    const r = parseToxicFetch(referring, backlinks);
    expect(r.total).toBe(812);
    const [spam, blog] = r.items;
    expect(spam).toMatchObject({ domain: "spam-links.xyz", spamScore: 88, footer: true, externalLinks: 220, language: "ru", anchors: ["ajustador publico miami"], dofollow: true });
    expect(blog).toMatchObject({ domain: "buen-blog.com", dofollow: false, rank: 320 });
    expect(parseBulkSpam([{ items: [{ target: "a-spam.xyz", spam_score: 70 }, { target: "bad", spam_score: 1 }] }])).toEqual(new Map([["a-spam.xyz", 70]]));
  });

  it("costos: se muestran antes, con los precios oficiales", () => {
    expect(toxicFetchCostEstimate(500)).toBeCloseTo(0.112, 3);
    expect(bulkSpamCostEstimate(471)).toBeCloseTo(0.041, 3);
    expect(bulkSpamCostEstimate(0)).toBe(0);
  });
});

describe("lista blanca: nunca se marcan", () => {
  it("tu sitio, tus otros sitios, plataformas, directorios, redes, gobierno y universidades", () => {
    expect(safeReason("ricardopa.com", ctx)).toBe("own");
    expect(safeReason("blog.ricardopa.com", ctx)).toBe("own");
    expect(safeReason("ricardopa-seguros.com", ctx)).toBe("partner");
    expect(safeReason("facebook.com", ctx)).toBe("platform");
    expect(safeReason("es.wikipedia.org", ctx)).toBe("platform");
    expect(safeReason("paginasamarillas.com.ni", ctx)).toBe("directory");
    expect(safeReason("yelp.com", ctx)).toBe("platform");
    expect(safeReason("napia.com", ctx)).toBe("directory");
    expect(safeReason("myfloridacfo.gov", ctx)).toBe("public");
    expect(safeReason("unan.edu.ni", ctx)).toBe("public");
    expect(safeReason("laprensani.com", ctx)).not.toBeNull();
  });
  it("pero un blog gratis de alguien o un «periódico» de casino no son seguros", () => {
    expect(safeReason("seo-links-free.blogspot.com", ctx)).toBeNull();
    expect(safeReason("casino-news.xyz", ctx)).toBeNull();
    expect(safeReason("yelp.xyz", ctx)).toBeNull();
  });
  it("aunque tenga spam 100, tu propio sitio sale seguro", () => {
    const c = classifyDomain(dom("ricardopa.com", { spamScore: 100, anchors: ["casino"] }), ctx);
    expect(c.level).toBe("seguro");
    expect(c.safe).toBe("own");
  });
});

describe("clasificación del riesgo", () => {
  it("casino en el nombre → alto, con la razón en palabras simples", () => {
    const c = classifyDomain(dom("best-casino-bonus.xyz"), ctx);
    expect(c.level).toBe("alto");
    expect(c.reasons.map((r) => r.id)).toEqual(expect.arrayContaining(["topic", "tld"]));
    expect(c.reasons.find((r) => r.id === "topic")!.text.es).toContain("casino");
  });
  it("no confunde palabras cortas dentro de otras (sussex, alphabet)", () => {
    expect(classifyDomain(dom("sussexroofing.co.uk", { spamScore: 5 }), ctx).level).toBe("seguro");
    expect(classifyDomain(dom("alphabetsoup.com", { spamScore: 5 }), ctx).level).toBe("seguro");
  });
  it("granja de enlaces: mucho spam, página con cientos de enlaces, pie de página, otro idioma", () => {
    const c = classifyDomain(dom("links-xyz1234.top", { spamScore: 85, externalLinks: 220, footer: true, language: "ru" }), ctx);
    expect(c.level).toBe("alto");
    expect(c.reasons.map((r) => r.id)).toEqual(expect.arrayContaining(["spam-high", "farm", "sitewide", "language", "tld", "name"]));
  });
  it("spam medio sin más señales → bajo; spam alto solo → medio", () => {
    expect(classifyDomain(dom("algo.com", { spamScore: 40 }), ctx).level).toBe("bajo");
    expect(classifyDomain(dom("algo.com", { spamScore: 65 }), ctx).level).toBe("medio");
  });
  it("a favor: sitio con fuerza y nofollow bajan el riesgo", () => {
    const c = classifyDomain(dom("revista-casas.com", { spamScore: 65, rank: 450, dofollow: false }), ctx);
    expect(c.level).toBe("seguro");
    expect(c.reasons.filter((r) => r.tone === "good").map((r) => r.id)).toEqual(["strong", "nofollow"]);
  });
  it("sitios automáticos de estadísticas: bajo, Google ya los ignora", () => {
    const c = classifyDomain(dom("ricardopa.com.hypestat.com", { spamScore: 70 }), ctx);
    expect(c.level).toBe("bajo");
    expect(c.reasons.some((r) => r.id === "stats")).toBe(true);
  });
  it("Semrush solo no alcanza para «alto» (marca de más)", () => {
    expect(classifyDomain(dom("directorio-raro.net", { toolScore: 90 }), ctx).level).toBe("bajo");
  });
  it("sin datos de spam ni señales → bajo con «no tenemos su nivel de spam»", () => {
    const c = classifyDomain(dom("algun-sitio.com"), ctx);
    expect(c.level).toBe("bajo");
    expect(c.reasons[0].id).toBe("no-data");
  });
  it("textos de venta exactos (y muchos a la vez) suman", () => {
    expect(isCommercialAnchor("ajustador publico miami", ctx)).toBe(true);
    expect(isCommercialAnchor("Ricardo PA", ctx)).toBe(false);
    expect(isCommercialAnchor("ricardopa.com", ctx)).toBe(false);
    expect(isCommercialAnchor("click here", ctx)).toBe(false);
    const many = Array.from({ length: 12 }, (_, i) => dom(`sitio${i}.net`, { anchors: ["ajustador publico miami"], spamScore: 35 }));
    expect(bulkCommercialAnchors(many, ctx).flagged).toBe(true);
    const rows = classifyAll(many, ctx, { now: NOW });
    expect(rows[0].reasons.map((r) => r.id)).toEqual(expect.arrayContaining(["anchor", "anchor-bulk", "spam-mid"]));
    expect(rows[0].level).toBe("medio");
  });
  it("classifyAll ordena de más riesgo a menos y junta con la lista importada", () => {
    const { items, sources } = mergeLinkLists([dom("a-ok.com", { spamScore: 2 }), dom("b-bad.xyz", { spamScore: 90 })], [dom("b-bad.xyz", { toolScore: 70, anchors: ["x"] }), dom("c-casino.top")]);
    const rows = classifyAll(items, ctx, { now: NOW, sources });
    // b-bad: spam 90 (+4), .xyz (+1), Semrush 70 (+2) = 7 · c-casino: casino (+5), .top (+1) = 6.
    expect(rows.map((r) => [r.domain, r.level, r.points])).toEqual([
      ["b-bad.xyz", "alto", 7],
      ["c-casino.top", "alto", 6],
      ["a-ok.com", "seguro", 0],
    ]);
    expect(rows[0].sources).toEqual(["dataforseo", "import"]);
    expect(rows[0].toolScore).toBe(70);
    expect(rows[1].sources).toEqual(["import"]);
    // Solo de la lista importada: no cuenta como «nuevo» por no estar en la revisión anterior.
    expect(classifyAll(items, ctx, { now: NOW, sources, previous: ["a-ok.com"] }).find((r) => r.domain === "c-casino.top")!.isNew).toBe(false);
  });
});

describe("¿un ataque?", () => {
  it("nuevo = visto en los últimos 30 días, o no estaba en la revisión anterior", () => {
    expect(isNewDomain(dom("a.com", { firstSeen: daysAgo(5) }), NOW, null)).toBe(true);
    expect(isNewDomain(dom("a.com", { firstSeen: daysAgo(90) }), NOW, new Set())).toBe(false);
    expect(isNewDomain(dom("a.com"), NOW, new Set(["b.com"]))).toBe(true);
    expect(isNewDomain(dom("a.com"), NOW, null)).toBe(false);
  });
  it("calm / watch / attack según los nuevos de riesgo y lo normal", () => {
    const rows = (risky: number, other = 0) => [...Array.from({ length: risky }, () => ({ level: "alto" as const, isNew: true })), ...Array.from({ length: other }, () => ({ level: "seguro" as const, isNew: true }))];
    expect(detectSpike({ rows: rows(2, 3) }).level).toBe("calm");
    expect(detectSpike({ rows: rows(9) }).level).toBe("watch");
    expect(detectSpike({ rows: rows(40), baselineMonthly: 5 }).level).toBe("attack");
    expect(detectSpike({ rows: rows(40), baselineMonthly: 30 }).level).toBe("watch");
    expect(detectSpike({ rows: rows(0, 30), baselineMonthly: 5 }).level).toBe("watch");
    expect(detectSpike({ rows: rows(1), newThisMonth: 50 }).newDomains).toBe(50);
    expect(baselineFromBacklinks({ newDomains1m: 10, newDomains3m: 30 })).toBe(10);
    expect(baselineFromBacklinks(null)).toBeNull();
  });
});

describe("«¿Necesito desautorizar?»", () => {
  it("acción manual → prepara el archivo", () => {
    expect(wizardOutcome({ manual: "yes", drop: "no", spike: "calm", high: 0 }).outcome).toBe("prepare");
  });
  it("caída fuerte + ataque → prepara; ataque sin caída → vigila", () => {
    expect(wizardOutcome({ manual: "no", drop: "yes", spike: "attack", high: 40 }).outcome).toBe("prepare");
    expect(wizardOutcome({ manual: "no", drop: "no", spike: "attack", high: 40 }).outcome).toBe("watch");
    expect(wizardOutcome({ manual: "no", drop: "no", spike: "watch", high: 5 }).outcome).toBe("watch");
  });
  it("lo normal (como Ricardo con 471 dominios de Semrush y sin acción manual) → no hagas nada", () => {
    const w = wizardOutcome({ manual: "no", drop: "no", spike: "calm", high: 471 });
    expect(w.outcome).toBe("nothing");
    expect(w.why[0].es).toContain("Google ya ignora");
  });
  it("bajó pero sin ataque → no hagas nada (la causa es otra); sin responder pide confirmar en Search Console", () => {
    const w = wizardOutcome({ manual: "no", drop: "yes", spike: "calm", high: 3 });
    expect(w.outcome).toBe("nothing");
    expect(w.why.at(-1)!.es).toContain("la causa probablemente es otra");
    const u = wizardOutcome({ manual: null, drop: null, spike: "calm", high: 0 });
    expect(u.outcome).toBe("nothing");
    expect(u.why[0].es).toContain("Search Console");
  });
});

describe("archivo para Google", () => {
  it("formato: comentarios con fecha y motivo, domain: ordenados, sin repetir, sin tu sitio ni sitios seguros", () => {
    const f = buildDisavowFile({
      site: "https://ricardopa.com",
      ownSites: ["ricardopa-seguros.com"],
      domains: ["zz-spam.top", "https://www.aa-casino.xyz/x", "aa-casino.xyz", "ricardopa.com", "facebook.com", "ricardopa-seguros.com", "no es dominio"],
      date: new Date("2026-10-09T15:00:00Z"),
      reason: "Acción manual\n# por enlaces",
      lang: "es",
    });
    expect(f.domains).toEqual(["aa-casino.xyz", "zz-spam.top"]);
    expect(f.excluded).toEqual(["ricardopa.com", "facebook.com", "ricardopa-seguros.com"]);
    const lines = f.text.trimEnd().split("\n");
    expect(lines[0]).toBe("# Archivo de desautorización de enlaces para ricardopa.com");
    expect(lines[1]).toBe("# Fecha: 2026-10-09");
    expect(lines[2]).toBe("# Motivo: Acción manual por enlaces");
    expect(lines[3]).toContain("reemplaza al anterior");
    expect(lines.slice(4)).toEqual(["domain:aa-casino.xyz", "domain:zz-spam.top"]);
    expect(lines.every((l) => l.startsWith("#") || /^domain:[a-z0-9.-]+$/.test(l))).toBe(true);
    expect(f.text.endsWith("\n")).toBe(true);
  });
  it("archivo vacío para deshacer y nombre del archivo", () => {
    const f = buildDisavowFile({ site: "ricardopa.com", domains: [], date: new Date("2026-10-09T00:00:00Z"), reason: "", lang: "en" });
    expect(f.domains).toEqual([]);
    expect(f.text).toContain("# Empty file");
    expect(f.text).not.toContain("domain:");
    expect(disavowFileName("https://www.ricardopa.com/", new Date("2026-10-09T00:00:00Z"))).toBe("disavow-ricardopa.com-2026-10-09.txt");
  });
});

describe("lo guardado y el aviso del plan", () => {
  const audit = (items: LinkDomain[], at: string): ToxicAudit => ({ version: 1, type: "audit", source: "dataforseo", domain: "ricardopa.com", createdAt: at, total: items.length, newThisMonth: null, items, cost: 0.1, notes: [] });
  it("lee revisiones y decisiones sin confiar en su forma", () => {
    expect(readToxicAudit({ type: "audit", items: [{ domain: "WWW.A-Spam.xyz", spamScore: 70 }, { domain: "" }] })!.items.map((i) => i.domain)).toEqual(["a-spam.xyz"]);
    expect(readToxicAudit({ type: "decision" })).toBeNull();
    expect(readDecision({ type: "decision", outcome: "watch", manual: "x", drop: "no" })).toMatchObject({ outcome: "watch", manual: "unsure", drop: "no" });
  });
  it("aviso: llegaron muchos sitios dañinos nuevos desde la revisión anterior", () => {
    const old = audit([dom("viejo-spam.xyz", { spamScore: 90 })], daysAgo(40));
    const bad = Array.from({ length: 12 }, (_, i) => dom(`casino-${i}.xyz`, { spamScore: 90, firstSeen: daysAgo(3) }));
    const now = audit([...old.items, ...bad, dom("facebook.com", { spamScore: 99, firstSeen: daysAgo(2) })], NOW.toISOString());
    const a = toxicAlert({ toxic: [{ data: old, createdAt: old.createdAt }, { data: now, createdAt: now.createdAt }], backlinks: [], ctx })!;
    expect(a.count).toBe(12);
    expect(a.attack).toBe(false);
    expect(a.domains).toHaveLength(5);
    expect(toxicAlert({ toxic: [{ data: old, createdAt: old.createdAt }], backlinks: [], ctx })).toBeNull();
  });
  it("aviso desde la revisión de enlaces: sitios nuevos con spam alto entre las dos últimas", () => {
    const prev = { referring: [{ domain: "a.com", spamScore: 10 }] };
    const next = { referring: [{ domain: "a.com", spamScore: 10 }, ...Array.from({ length: 10 }, (_, i) => ({ domain: `spam${i}.top`, spamScore: 75 })), { domain: "yelp.com", spamScore: 80 }] };
    const a = toxicAlert({ toxic: [], backlinks: [{ data: next, createdAt: NOW }, { data: prev, createdAt: daysAgo(30) }], ctx })!;
    expect(a.count).toBe(10);
    expect(a.source).toBe("backlinks");
  });
});
