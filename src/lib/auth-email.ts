// Correos de la cuenta (invitación, contraseña nueva) con el Brevo de la app (BREVO_API_KEY). Remitente: AUTH_EMAIL_FROM
// («Matya <hola@tu-dominio>»), o ALERTS_FROM, o matya@ el primer dominio autenticado en Brevo. Nunca lanza: si no sale,
// devuelve false y la pantalla ofrece copiar el enlace.
import { brevoDomains, brevoEnvKey } from "@/lib/brevo";
import { fetchJson } from "@/lib/publishers/http";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function parseFrom(raw: string): { name: string; email: string } {
  const m = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(raw);
  if (m) return { name: m[1].replace(/["<>]/g, "").trim(), email: m[2] };
  return { name: "", email: /^[^\s@]+@[^\s@]+$/.test(raw.trim()) ? raw.trim() : "" };
}

async function sender(): Promise<{ name: string; email: string; apiKey: string } | null> {
  const apiKey = brevoEnvKey();
  if (!apiKey) return null;
  const from = parseFrom(process.env.AUTH_EMAIL_FROM?.trim() || process.env.ALERTS_FROM?.trim() || "");
  let email = from.email;
  if (!email) {
    const domain = (await brevoDomains(apiKey))[0];
    if (!domain) return null;
    email = `matya@${domain}`;
  }
  return { name: from.name || "Matya", email, apiKey };
}

export type AuthEmail = { to: string; subject: string; intro: string[]; facts?: [string, string][]; button: { label: string; href: string }; footer: string };

/** El correo en HTML sencillo (todo el texto escapado) y en texto plano. */
export function renderAuthEmail(m: AuthEmail): { html: string; text: string } {
  const facts = (m.facts ?? []).map(([k, v]) => `<p style="margin:0 0 6px"><span style="color:#666">${esc(k)}</span> <strong>${esc(v)}</strong></p>`).join("");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:Arial,Helvetica,sans-serif;color:#0a0a0a">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e8e8e8;border-radius:16px;padding:28px">
<p style="margin:0 0 18px;font-size:22px;font-weight:bold">Matya</p>
${m.intro.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5">${esc(p)}</p>`).join("")}
${facts ? `<div style="margin:0 0 18px;padding:14px 16px;background:#f6f6f4;border-radius:12px;font-size:14px">${facts}</div>` : ""}
<p style="margin:0 0 18px"><a href="${esc(m.button.href)}" style="display:inline-block;padding:12px 22px;background:#14c4b4;color:#0a0a0a;border-radius:999px;font-weight:bold;text-decoration:none">${esc(m.button.label)}</a></p>
<p style="margin:0;font-size:12px;color:#666;line-height:1.5">${esc(m.footer)}</p>
</div></body></html>`;
  const text = [...m.intro, ...(m.facts ?? []).map(([k, v]) => `${k} ${v}`), "", `${m.button.label}: ${m.button.href}`, "", m.footer].join("\n");
  return { html, text };
}

/** Manda el correo. true si Brevo lo aceptó. */
export async function sendAuthEmail(m: AuthEmail): Promise<boolean> {
  try {
    const from = await sender();
    if (!from) return false;
    const { html, text } = renderAuthEmail(m);
    await fetchJson("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": from.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sender: { name: from.name, email: from.email }, to: [{ email: m.to }], subject: m.subject, htmlContent: html, textContent: text }),
    });
    return true;
  } catch (e) {
    console.error("auth email failed:", e instanceof Error ? e.message.slice(0, 200) : e);
    return false;
  }
}
