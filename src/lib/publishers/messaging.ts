import { smsBody } from "@/lib/channels";
import { escapeHtml, paragraphs } from "@/lib/text";
import { fetchJson, form, PublishError, required } from "./http";
import type { Publisher } from "./types";

export const email: Publisher = {
  async publish(input, creds) {
    required(creds, ["apiKey", "from"]);
    const to = input.contacts.filter((c) => c.emailOptIn && c.email.includes("@"));
    if (!to.length) throw new PublishError("No hay contactos con email que hayan aceptado recibir correos.");

    let html = paragraphs(input.text);
    if (input.mediaType === "photo" && input.mediaUrl)
      html = `<p><img src="${escapeHtml(input.mediaUrl)}" alt="" style="max-width:100%"></p>` + html;
    html += `<hr><p style="font-size:12px;color:#58595B">Recibes este correo de ${escapeHtml(input.businessName)}. Si ya no quieres recibirlos, responde a este correo con la palabra BAJA.</p>`;

    // Un correo por persona (nadie ve los correos de los demás), en lotes de 100.
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
