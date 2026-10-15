import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { YoutubeOptionsFields } from "@/components/posts/YoutubeOptionsFields";

vi.mock("@/components/posts/youtube.module.css", () => ({ default: new Proxy({}, { get: (_, k) => String(k) }) }));

describe("campos de YouTube: la persona ve y elige lo que se sube", () => {
  const html = renderToStaticMarkup(
    <YoutubeOptionsFields lang="en" idPrefix="d1" mediaUrl="https://cdn.example.com/v.mp4" title="Portones" description="Desc" tags={["a", "b c"]} verb="approve" />,
  );

  it("muestra el video, el título, la descripción y las etiquetas exactas", () => {
    expect(html).toContain('<video');
    expect(html).toContain('preload="metadata"');
    expect(html).toMatch(/name="yt_title"[^>]*value="Portones"/);
    expect(html).toMatch(/<textarea[^>]*name="v_youtube"[^>]*>Desc<\/textarea>/);
    expect(html).toMatch(/name="yt_tags"[^>]*value="a, b c"/);
    expect(html).toContain("These exact tags are sent to YouTube.");
    expect(html).toContain("Category: People &amp; Blogs");
  });

  it("privacidad y «para niños» obligatorias y sin nada elegido de entrada", () => {
    const radios = [...html.matchAll(/<input type="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios.filter((r) => r.includes('name="yt_privacy"')).map((r) => r.match(/value="(\w+)"/)?.[1])).toEqual(["public", "unlisted", "private"]);
    expect(radios.filter((r) => r.includes('name="yt_kids"')).map((r) => r.match(/value="(\w+)"/)?.[1])).toEqual(["no", "yes"]);
    expect(radios.every((r) => r.includes('required=""'))).toBe(true);
    expect(html).not.toContain("checked");
    expect(html).toContain("Public");
    expect(html).toContain("Unlisted");
    expect(html).toContain("Private");
  });

  it("el permiso y los términos de YouTube y la privacidad de Google", () => {
    expect(html).toContain("By approving, you authorize Matya to upload this video to your YouTube channel with this title, description, tags and visibility.");
    expect(html).toContain('href="https://www.youtube.com/t/terms"');
    expect(html).toContain('href="https://policies.google.com/privacy"');
    const es = renderToStaticMarkup(<YoutubeOptionsFields lang="es" idPrefix="x" title="T" tags="" verb="post" />);
    expect(es).toContain("Al publicar, autorizas a Matya a subir este video a tu canal de YouTube");
    // Sin descripción ni video: la pantalla manda su propio texto.
    expect(es).not.toContain('name="v_youtube"');
    expect(es).not.toContain("<video");
  });
});
