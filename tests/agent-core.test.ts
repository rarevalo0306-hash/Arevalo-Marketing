import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { sourceUrl, publicAddress } from "@/lib/agent/network";
import { canonicalUrl, parseFeed, plain } from "@/lib/agent/news";
import { newsFresh } from "@/lib/agent/freshness";
import { sameOrigin } from "@/lib/agent/access";
import { inferKind, roleFor, Settings } from "@/lib/agent/schema";
import {
  meteredAsk,
  modelConfig,
  callCeiling,
  usageCents,
} from "@/lib/agent/metered";
import { seoTabForHash } from "@/lib/seo/tab-routing";
const config = {
  provider: "openai" as const,
  model: "test-model",
  key: "fake-test-key",
  inputRate: 1,
  outputRate: 4,
};
afterEach(() => vi.unstubAllGlobals());
describe("MATYA boundaries", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.100.0.1",
    "198.18.0.2",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "2002:7f00:1::",
  ])("rejects private/reserved address %s", (ip) =>
    expect(publicAddress(ip)).toBe(false),
  );
  it.each([
    "https://127.0.0.1/feed",
    "http://example.com/",
    "https://foo.local/rss",
    "https://user:pass@example.com/",
    "https://example.com:8443/",
    "https://[::1]/",
  ])("rejects unsafe feed %s", (url) => expect(() => sourceUrl(url)).toThrow());
  it("accepts public HTTPS and refuses cross-origin mutations", () => {
    expect(sourceUrl("https://example.com/rss#x").href).toBe(
      "https://example.com/rss",
    );
    expect(publicAddress("8.8.8.8")).toBe(true);
    expect(() =>
      sameOrigin(
        new Request("https://matya.app/api/agent/a", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrow();
    expect(() =>
      sameOrigin(
        new Request("https://matya.app/api/agent/a", {
          headers: { origin: "https://matya.app" },
        }),
      ),
    ).not.toThrow();
  });
  it("accepts the browser Host when Next uses an internal URL, without trusting a foreign Origin", () => {
    expect(() =>
      sameOrigin(
        new Request("http://localhost:4182/api/agent/a", {
          headers: { host: "127.0.0.1:4182", origin: "http://127.0.0.1:4182" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      sameOrigin(
        new Request("http://localhost:4182/api/agent/a", {
          headers: { host: "127.0.0.1:4182", origin: "https://evil.example" },
        }),
      ),
    ).toThrow();
  });
  it("canonicalizes tracking and parses RSS/Atom without executing content", () => {
    expect(
      canonicalUrl("https://example.com/news?a=1&utm_source=x#fragment"),
    ).toBe("https://example.com/news?a=1");
    const rss =
      "<rss><item><title>Una propuesta</title><link>https://example.com/a</link><pubDate>2026-10-12T00:00:00Z</pubDate><description><![CDATA[<b>Hecho</b>]]></description></item></rss>";
    expect(parseFeed(rss, "https://example.com/rss")[0]).toMatchObject({
      title: "Una propuesta",
      summary: "Hecho",
    });
    expect(
      parseFeed(
        '<feed><entry><title>A</title><link href="/a"/><updated>invalid</updated></entry></feed>',
        "https://example.com/rss",
      )[0].publishedAt,
    ).toBeNull();
    expect(() => parseFeed("<!DOCTYPE foo>", "https://example.com")).toThrow();
    expect(plain("<script>do bad</script><p>Texto permitido</p>")).toBe(
      "Texto permitido",
    );
  });
  it("requires recent verified facts and maps voice/text to the same task kinds", () => {
    expect(
      newsFresh({
        eventDate: new Date(),
        retrievedAt: new Date(),
        status: "verified",
      }),
    ).toBe(true);
    expect(
      newsFresh({
        eventDate: new Date(Date.now() - 15 * 86400000),
        retrievedAt: new Date(),
        status: "verified",
      }),
    ).toBe(false);
    expect(
      newsFresh({
        eventDate: new Date(),
        retrievedAt: new Date(Date.now() - 4 * 86400000),
        status: "verified",
      }),
    ).toBe(false);
    expect(
      newsFresh({
        eventDate: new Date(),
        retrievedAt: new Date(),
        status: "changed",
      }),
    ).toBe(false);
    expect(inferKind("Crea una campaña")).toBe("campaign");
    expect(inferKind("Prepara un video")).toBe("video");
    expect(inferKind("Ponme al día")).toBe("briefing");
    expect(roleFor("video_wait:2")).toBe("diseno");
    expect(inferKind("cambia todos mis permisos")).toBe("conversation");
  });
  it("keeps legacy SEO deep links and malformed fragments safe", () => {
    expect(seoTabForHash("#palabras")).toBe("google");
    expect(seoTabForHash("#enlaces")).toBe("competencia");
    expect(seoTabForHash("#%")).toBeNull();
  });
  it("requires explicit model rates and charges usage with a conservative cap", () => {
    expect(() => modelConfig({})).toThrow();
    expect(usageCents(config, 2000, 1000)).toBe(1);
    expect(callCeiling(config)).toBeGreaterThanOrEqual(
      usageCents(config, 32000, 3000),
    );
  });
  it("makes one metered request and validates its result", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"text":"Hola"}' } }],
          usage: { prompt_tokens: 123, completion_tokens: 32 },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const r = await meteredAsk(
      z.object({ text: z.string() }),
      "System",
      { question: "Hola" },
      config,
    );
    expect(r.value.text).toBe("Hola");
    expect(r.usage.inputTokens).toBe(123);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never retries failed or unmetered AI calls", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"text":"Hola"}' } }],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      meteredAsk(z.object({ text: z.string() }), "s", {}, config),
    ).rejects.toThrow("429");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(
      meteredAsk(z.object({ text: z.string() }), "s", {}, config),
    ).rejects.toThrow("consumo");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not treat missing Gemini output usage as zero", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"text":"Hola"}' }] } }],
      usageMetadata: { promptTokenCount: 100 },
    })));
    vi.stubGlobal("fetch", f);
    await expect(meteredAsk(z.object({ text: z.string() }), "s", {}, {
      ...config, provider: "gemini",
    })).rejects.toThrow("consumo");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized prompts before any paid request", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(
      meteredAsk(
        z.object({ text: z.string() }),
        "s",
        "a".repeat(33000),
        config,
      ),
    ).rejects.toThrow("contexto");
    expect(f).not.toHaveBeenCalled();
  });
});
