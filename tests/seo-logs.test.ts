import { describe, expect, it } from "vitest";
import { addLogLine, botOf, cleanPath, clfTime, finishLog, newLogAcc, parseLogLine, pathOf, readLogReport } from "@/lib/seo/logs";

const GOOGLE_MOBILE = "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.126 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const GOOGLE_DESKTOP = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const line = (ip: string, when: string, req: string, status: number, ua: string) => `${ip} - - [${when}] "${req}" ${status} 5120 "-" "${ua}"`;

describe("Registro de visitas", () => {
  it("reconoce los robots por lo que dicen ser", () => {
    expect(botOf(GOOGLE_MOBILE)?.id).toBe("google");
    expect(botOf("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)")?.id).toBe("chatgpt");
    expect(botOf("Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)")?.id).toBe("gptbot");
    expect(botOf("Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)")?.id).toBe("claudebot");
    expect(botOf("Mozilla/5.0 (compatible; Claude-User/1.0)")?.id).toBe("claude");
    expect(botOf("Mozilla/5.0 (compatible; PerplexityBot/1.0)")?.id).toBe("perplexity");
    expect(botOf("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)")?.id).toBe("bing");
    expect(botOf("Mozilla/5.0 (compatible; AhrefsBot/7.0)")?.id).toBe("seo");
    expect(botOf("SomethingCrawler/1.0")?.id).toBe("other");
    expect(botOf(CHROME)).toBeNull();
    expect(botOf("")).toBeNull();
  });

  it("lee la hora del formato de Apache y Nginx (a UTC)", () => {
    expect(new Date(clfTime("10/Oct/2026:13:55:36 -0700") as number).toISOString()).toBe("2026-10-10T20:55:36.000Z");
    expect(clfTime("ayer")).toBeNull();
  });

  it("limpia la ruta: sin dominio, sin lo que va después de «?»", () => {
    expect(cleanPath("/servicios/techos?utm_source=x&email=a@b.com")).toEqual({ path: "/servicios/techos", params: true });
    expect(cleanPath("https://x.com/a%C3%B1o#top")).toEqual({ path: "/año", params: false });
    expect(cleanPath("/x?")).toEqual({ path: "/x", params: false });
    expect(pathOf("https://x.com/servicios/")).toBe("/servicios");
    expect(pathOf("https://x.com/")).toBe("/");
  });

  it("lee líneas combined y JSON, y descarta lo que no entiende", () => {
    expect(parseLogLine(line("66.249.66.1", "10/Oct/2026:13:55:36 +0000", "GET /contacto?x=1 HTTP/1.1", 200, GOOGLE_MOBILE))).toEqual({
      path: "/contacto",
      status: 200,
      ua: GOOGLE_MOBILE,
      ms: Date.UTC(2026, 9, 10, 13, 55, 36),
      day: "2026-10-10",
      params: true,
    });
    const json = parseLogLine(JSON.stringify({ timestamp: 1791640536000, path: "/precios", statusCode: 404, userAgent: GOOGLE_DESKTOP }));
    expect(json).toMatchObject({ path: "/precios", status: 404, day: "2026-10-10" });
    expect(parseLogLine(JSON.stringify({ ClientRequestURI: "/a", EdgeResponseStatus: 301, ClientRequestUserAgent: "x", EdgeStartTimestamp: "2026-10-10T00:00:00Z" }))).toMatchObject({ path: "/a", status: 301, day: "2026-10-10" });
    expect(parseLogLine("[error] something broke")).toBeNull();
    expect(parseLogLine("{no json")).toBeNull();
    expect(parseLogLine("")).toBeNull();
  });

  it("arma el resumen sin IPs y con las páginas que Google no visitó", () => {
    const acc = newLogAcc();
    const lines = [
      line("66.249.66.1", "10/Oct/2026:10:00:00 +0000", "GET / HTTP/1.1", 200, GOOGLE_MOBILE),
      line("66.249.66.1", "10/Oct/2026:10:01:00 +0000", "GET /servicios/ HTTP/1.1", 200, GOOGLE_MOBILE),
      line("66.249.66.2", "11/Oct/2026:10:00:00 +0000", "GET /viejo HTTP/1.1", 404, GOOGLE_DESKTOP),
      line("66.249.66.2", "11/Oct/2026:10:00:01 +0000", "GET /style.css HTTP/1.1", 200, GOOGLE_DESKTOP),
      line("66.249.66.2", "11/Oct/2026:10:00:02 +0000", "GET /buscar?q=techo HTTP/1.1", 200, GOOGLE_DESKTOP),
      line("20.1.1.1", "11/Oct/2026:11:00:00 +0000", "GET /servicios HTTP/1.1", 200, "Mozilla/5.0 (compatible; OAI-SearchBot/1.0)"),
      line("20.1.1.1", "11/Oct/2026:11:00:00 +0000", "GET /viejo HTTP/1.1", 404, "Mozilla/5.0 (compatible; ClaudeBot/1.0)"),
      line("190.1.1.1", "11/Oct/2026:12:00:00 +0000", "GET / HTTP/1.1", 200, CHROME),
      "basura",
    ];
    for (const l of lines) addLogLine(acc, l);
    const r = finishLog(acc, { files: ["access.log"], sitePaths: ["https://x.com/", "https://x.com/servicios", "https://x.com/contacto/"], now: new Date("2026-10-14T00:00:00Z") });
    expect(r).toMatchObject({ lines: 9, parsed: 8, from: "2026-10-10", to: "2026-10-11", people: 1, missed: ["/contacto"], checked: 3, googleParams: 1, googleResources: 1 });
    expect(r.bots.map((b) => [b.id, b.hits, b.pages, b.clientErrors, b.mobile])).toEqual([
      ["google", 5, 5, 1, 2],
      ["chatgpt", 1, 1, 0, 0],
      ["claudebot", 1, 1, 1, 0],
    ]);
    expect(r.days).toEqual([
      { day: "2026-10-10", google: 2, ai: 0 },
      { day: "2026-10-11", google: 3, ai: 2 },
    ]);
    expect(r.errors).toEqual([{ path: "/viejo", status: 404, hits: 2, bots: ["google", "claudebot"] }]);
    expect(r.topGoogle.map((p) => p.path)).toEqual(["/", "/buscar", "/servicios/", "/viejo"]);
    // Nada de direcciones IP en lo que se guarda.
    expect(JSON.stringify(r)).not.toMatch(/66\.249|20\.1\.1|190\.1/);
  });

  it("en el servidor solo acepta un resumen limpio", () => {
    const acc = newLogAcc();
    addLogLine(acc, line("1.1.1.1", "10/Oct/2026:10:00:00 +0000", "GET /a HTTP/1.1", 200, GOOGLE_DESKTOP));
    const good = finishLog(acc, { files: ["a.log"], now: new Date("2026-10-14T00:00:00Z") });
    expect(readLogReport(JSON.parse(JSON.stringify(good)))).toEqual(good);
    const evil = { ...good, bots: [{ id: "hacker", hits: 1 }, { id: "google", hits: -5, pages: 1e20 }], topGoogle: [{ path: "javascript:x", hits: 1 }], errors: [{ path: "/a", status: 200, hits: 1, bots: [] }], files: ["x".repeat(500)] };
    const read = readLogReport(evil);
    expect(read?.bots).toEqual([{ id: "google", hits: 0, pages: 1e12, ok: 0, redirects: 0, clientErrors: 0, serverErrors: 0, lastSeen: null, mobile: 0 }]);
    expect(read?.topGoogle).toEqual([]);
    expect(read?.errors).toEqual([]);
    expect(read?.files[0]).toHaveLength(120);
    expect(readLogReport({ version: 2, bots: [] })).toBeNull();
  });
});
