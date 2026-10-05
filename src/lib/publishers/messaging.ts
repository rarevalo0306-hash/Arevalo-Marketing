import { smsBody } from "@/lib/channels";
import { escapeHtml, paragraphs } from "@/lib/text";
import { fetchJson, form, PublishError, required } from "./http";
import type { Publisher } from "./types";

/** La clave dice qué servicio es: Brevo empieza con "xkeysib-"; Resend con "re_". */
export const isBrevo = (apiKey: string) => apiKey.trim().startsWith("xkeysib-");

/** "Mi Negocio <info@negocio.com>" → { name, email } */
export function parseFrom(from: string): { name: string; email: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: "", email: from.trim() };
}

export const email: Publisher = {
  async publish(input, creds) {
    required(creds, ["apiKey", "from"]);
    const to = input.contacts.filter((c) => c.emailOptIn && c.email.includes("@"));
    if (!to.length) throw new PublishError("No hay contactos con email que hayan aceptado recibir correos.");

    let html = paragraphs(input.text);
    if (input.mediaType === "photo" && input.mediaUrl)
      html = `<p><img src="${escapeHtml(input.mediaUrl)}" alt="" style="max-width:100%"></p>` + html;
    html += `<hr><p style="font-size:12px;color:#58595B">Recibes este correo de ${escapeHtml(input.businessName)}. Si ya no quieres recibirlos, responde a este correo con la palabra BAJA.</p>`;

    // Brevo: un correo por persona con "messageVersions", hasta 1000 por llamada.
    if (isBrevo(creds.apiKey)) {
      const sender = parseFrom(creds.from);
      let sent = 0;
      for (let i = 0; i < to.length; i += 1000) {
        const batch = to.slice(i, i + 1000);
        await fetchJson("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": creds.apiKey.trim(), "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            sender: sender.name ? sender : { email: sender.email },
            subject: input.subject,
            htmlContent: html,
            textContent: input.text,
            messageVersions: batch.map((c) => ({ to: [c.name ? { email: c.email, name: c.name } : { email: c.email }] })),
          }),
        });
        sent += batch.length;
      }
      return { detail: `Email enviado a ${sent} ${sent === 1 ? "contacto" : "contactos"}` };
    }

    // Resend: un correo por persona (nadie ve los correos de los demás), en lotes de 100.
    let sent = 0;
    for (let i = 0; i < to.length; i += 100) {
      const batch = to.slice(i, i + 100).map((c) => ({
        from: creds.from,
        to: [c.email],
        subject: input.subject,
        html,
        text: input.text,
      }));
      await fetchJson("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
      sent += batch.length;
    }
    return { detail: `Email enviado a ${sent} ${sent === 1 ? "contacto" : "contactos"}` };
  },
  async test(creds) {
    required(creds, ["apiKey", "from"]);
    if (isBrevo(creds.apiKey)) {
      const headers = { "api-key": creds.apiKey.trim(), Accept: "application/json" };
      const acct = await fetchJson<{ plan?: { type: string; credits?: number }[] }>("https://api.brevo.com/v3/account", { headers });
      const d = await fetchJson<{ domains?: { domain_name: string; authenticated: boolean }[] }>("https://api.brevo.com/v3/senders/domains", { headers });
      const domain = parseFrom(creds.from).email.split("@")[1]?.toLowerCase() ?? "";
      const ok = d.domains?.some((x) => x.domain_name.toLowerCase() === domain && x.authenticated);
      const plan = acct.plan?.[0];
      const planText = plan ? ` Plan ${plan.type}${plan.type === "free" ? " (300 correos al día)" : ""}.` : "";
      return ok
        ? `Conectado a Brevo. El dominio ${domain} está autenticado.${planText}`
        : `Conectado a Brevo, pero el dominio ${domain || "del remitente"} no está autenticado en Brevo todavía.${planText}`;
    }
    const r = await fetchJson<{ data: { name: string; status: string }[] }>("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${creds.apiKey}` },
    });
    const verified = r.data.filter((d) => d.status === "verified").map((d) => d.name);
    return verified.length ? `Conectado. Dominios verificados: ${verified.join(", ")}` : "Conectado, pero no hay dominios verificados todavía";
  },
};

export const sms: Publisher = {
  async publish(input, creds) {
    required(creds, ["accountSid", "authToken", "from"]);
    const to = input.contacts.filter((c) => c.smsOptIn && c.phone.trim());
    if (!to.length) throw new PublishError("No hay contactos con teléfono que hayan aceptado recibir textos.");
    const auth = "Basic " + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
    const body = smsBody(input.text);
    let ok = 0;
    const failed: string[] = [];
    for (const c of to) {
      try {
        await fetchJson(`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`, {
          method: "POST",
          headers: { Authorization: auth },
          body: form({ To: c.phone.trim(), From: creds.from, Body: body }),
        });
        ok++;
      } catch (e) {
        failed.push(`${c.phone}: ${(e as Error).message}`);
      }
    }
    if (!ok) throw new PublishError(`No se pudo enviar ningún texto. ${failed[0] ?? ""}`);
    const extra = failed.length ? ` ${failed.length} fallaron (${failed.slice(0, 3).join("; ")})` : "";
    return { detail: `Texto enviado a ${ok} ${ok === 1 ? "contacto" : "contactos"}.${extra}` };
  },
  async test(creds) {
    required(creds, ["accountSid", "authToken", "from"]);
    const auth = "Basic " + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
    const a = await fetchJson<{ friendly_name: string }>(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}.json`,
      { headers: { Authorization: auth } },
    );
    return `Conectado a la cuenta "${a.friendly_name}"`;
  },
};
