import { seoDescription } from "@/lib/channels";
import { escapeHtml, paragraphs } from "@/lib/text";
import { fetchJson, required } from "./http";
import type { Creds, Publisher } from "./types";

function base(creds: Creds): string {
  return creds.siteUrl.trim().replace(/\/+$/, "");
}

function auth(creds: Creds): string {
  return "Basic " + Buffer.from(`${creds.username}:${creds.appPassword.replace(/\s+/g, "")}`).toString("base64");
}

export const wordpress: Publisher = {
  async publish(input, creds) {
    required(creds, ["siteUrl", "username", "appPassword"]);
    let content = paragraphs(input.text);
    if (input.mediaType === "photo" && input.mediaUrl)
      content = `<p><img src="${escapeHtml(input.mediaUrl)}" alt="${escapeHtml(input.seoTitle)}"></p>\n` + content;
    if (input.mediaType === "video" && input.mediaUrl)
      content = `<p><video src="${escapeHtml(input.mediaUrl)}" controls></video></p>\n` + content;
    const post = await fetchJson<{ link: string }>(`${base(creds)}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: { Authorization: auth(creds), "Content-Type": "application/json" },
      body: JSON.stringify({
        title: input.seoTitle,
        content,
        excerpt: seoDescription(input.text),
        status: "publish",
      }),
    });
    return { url: post.link, detail: "Artículo publicado en tu sitio" };
  },
  async test(creds) {
    required(creds, ["siteUrl", "username", "appPassword"]);
    const me = await fetchJson<{ name: string }>(`${base(creds)}/wp-json/wp/v2/users/me`, {
      headers: { Authorization: auth(creds) },
    });
    return `Conectado como ${me.name}`;
  },
};
