import Link from "next/link";
import { approveDraft, deletePost, generatePlan } from "@/app/actions";
import { PageHead } from "@/components/PageHead";
import { PlanForm } from "@/components/PlanForm";
import { aiEnabled } from "@/lib/ai";
import { CHANNELS, channelDef } from "@/lib/channels";
import { db } from "@/lib/db";
import { BUSINESS_TZ } from "@/lib/time";

// La IA puede tardar en escribir una semana completa.
export const maxDuration = 300;

const fmt = new Intl.DateTimeFormat("es", { dateStyle: "full", timeStyle: "short", timeZone: BUSINESS_TZ });

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await db.business.findUniqueOrThrow({ where: { id }, include: { connections: { select: { channel: true } } } });
  const drafts = await db.post.findMany({ where: { businessId: id, status: "draft" }, include: { targets: true }, orderBy: { scheduledAt: "asc" } });
  const connected = new Set(b.connections.map((c) => c.channel));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });

  return (
    <>
      <PageHead business={b} prefix="Plan con IA para" title="Plan con IA" subtitle="La IA prepara tus publicaciones de la semana. Tú revisas, cambias lo que quieras y apruebas." />
      {!aiEnabled() ? (
        <div className="card empty">Falta la clave de la IA (ANTHROPIC_API_KEY) en Vercel.</div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {!b.aiProfile.trim() && (
            <p className="note">
              Antes de empezar, cuéntale a la IA sobre tu negocio en <Link href={`/b/${id}/negocio`}>Ajustes del negocio</Link>. Así no escribe cosas genéricas.
            </p>
          )}
          <PlanForm
            action={generatePlan.bind(null, id)}
            channels={CHANNELS.map((c) => ({ id: c.id, name: c.name, connected: connected.has(c.id) }))}
            today={today}
            autopublish={b.aiAutopublish}
          />
          <h2 style={{ marginTop: 8 }}>Borradores por aprobar ({drafts.length})</h2>
          {drafts.length === 0 && <div className="card empty">No hay borradores. Crea un plan arriba.</div>}
          {drafts.map((p) => {
            const variants = (p.variants ?? {}) as Record<string, string>;
            return (
              <article key={p.id} className="card">
                <form action={approveDraft.bind(null, id, p.id)} className="stack" style={{ gap: 12 }}>
                  <div className="row between">
                    <div className="row">
                      <span className="pill draft">Borrador</span>
                      <span className="small muted">Saldría el {fmt.format(p.scheduledAt)}</span>
                    </div>
                  </div>
                  {p.targets.some((t) => t.channel === "email") && (
                    <div className="stack" style={{ gap: 4 }}>
                      <label className="small" style={{ fontWeight: 600 }} htmlFor={`${p.id}-subject`}>Asunto del email</label>
                      <input id={`${p.id}-subject`} name="subject" className="field" defaultValue={p.subject} />
                    </div>
                  )}
                  {p.targets.map((t) => (
                    <div key={t.id} className="stack" style={{ gap: 4 }}>
                      <label className="small" style={{ fontWeight: 600 }} htmlFor={`${p.id}-${t.channel}`}>{channelDef(t.channel)?.name ?? t.channel}</label>
                      <textarea
                        id={`${p.id}-${t.channel}`}
                        name={`v_${t.channel}`}
                        className="field"
                        style={{ minHeight: t.channel === "sms" ? 70 : 140 }}
                        defaultValue={variants[t.channel] ?? p.text}
                      />
                    </div>
                  ))}
                  <div className="row">
                    <button className="btn on" type="submit">Aprobar y programar</button>
                    <button className="btn danger" type="submit" formAction={deletePost.bind(null, id, p.id)}>Borrar</button>
                  </div>
                </form>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
