import Link from "next/link";
import { generateStudy, saveStudyProfile } from "@/app/actions";
import { PageHead } from "@/components/PageHead";
import { StudyForm } from "@/components/StudyForm";
import { aiEnabled, researchProvider, TEXT_PROVIDERS } from "@/lib/ai";
import { db } from "@/lib/db";
import { campaignIdea, EMPTY_INPUT, readInput, readStudy } from "@/lib/study-shape";
import { BUSINESS_TZ } from "@/lib/time";

// La IA investiga en internet y luego escribe el estudio: puede tardar.
export const maxDuration = 300;

const fmt = new Intl.DateTimeFormat("es", { dateStyle: "long", timeZone: BUSINESS_TZ });
const INTENT: Record<string, [string, string]> = {
  local: ["Local", "scheduled"],
  comercial: ["Quiere contratar", "done"],
  informativa: ["Quiere aprender", "draft"],
};
const LEVEL: Record<string, string> = { alto: "done", medio: "scheduled", bajo: "", alta: "failed", media: "partial", baja: "done" };

export default async function EstudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await db.business.findUniqueOrThrow({ where: { id } });
  const study = readStudy(b.study);
  const input = readInput(b.studyInput) ?? { ...EMPTY_INPUT, services: b.aiProfile.slice(0, 2000) };
  const researcher = researchProvider(b.aiText);
  const create = (idea: string) => `/b/${id}/publicar?${new URLSearchParams({ idea: idea.slice(0, 2000), magic: "1" })}`;

  return (
    <>
      <PageHead
        business={b}
        prefix="Estudio de"
        title="Estudio del negocio"
        subtitle="La IA estudia tu negocio y tu mercado local: a quién venderle, qué busca la gente en Google y qué anunciar. Todo lo que escribe y diseña después (textos, fotos, videos y campañas) sale de aquí."
      />
      {!aiEnabled() ? (
        <div className="card empty">Falta la clave de la IA (GEMINI_API_KEY, ANTHROPIC_API_KEY u OPENAI_API_KEY) en Vercel.</div>
      ) : (
        <div className="stack" style={{ gap: 22 }}>
          {study ? (
            <details className="card" style={{ gap: 0 }}>
              <summary className="row between" style={{ cursor: "pointer" }}>
                <span className="stack" style={{ gap: 2 }}>
                  <strong>Estudio del {b.studyAt ? fmt.format(b.studyAt) : "—"}</strong>
                  <span className="small muted">{study.researched ? `Con investigación en internet (${study.sources.length} fuentes)` : "Sin investigación en internet"}. Ábrelo para cambiar tus respuestas y actualizarlo.</span>
                </span>
                <span className="btn">Actualizar</span>
              </summary>
              <div style={{ marginTop: 18 }}>
                <StudyForm action={generateStudy.bind(null, id)} input={input} researcher={researcher && TEXT_PROVIDERS.find((p) => p.id === researcher)!.name} has />
              </div>
            </details>
          ) : (
            <StudyForm action={generateStudy.bind(null, id)} input={input} researcher={researcher && TEXT_PROVIDERS.find((p) => p.id === researcher)!.name} has={false} />
          )}

          {study && (
            <>
              <div className="grid-2">
                <section className="card">
                  <h2>Lo que entendió la IA</h2>
                  <p>{study.summary}</p>
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">Qué anunciar</span>
                    <ul className="study-list">
                      {study.services.map((s, i) => <li key={i}><strong>{s.name}.</strong> {s.description}</li>)}
                    </ul>
                  </div>
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">Por qué elegirte</span>
                    <ul className="study-list">{study.differentiators.map((d, i) => <li key={i}>{d}</li>)}</ul>
                  </div>
                </section>
                <form action={saveStudyProfile.bind(null, id)} className="card">
                  <h2>Perfil del negocio para la IA</h2>
                  <p className="small muted">
                    Esto es lo único que la IA dirá de tu negocio como un hecho. Revisa que todo sea cierto, corrige lo que haga falta y guárdalo.
                    {b.aiProfile.trim() ? " Reemplaza el perfil que tienes en Ajustes." : ""}
                  </p>
                  <textarea name="aiProfile" className="field" style={{ minHeight: 220 }} maxLength={4000} defaultValue={b.aiProfile.trim() === study.suggestedProfile.trim() ? b.aiProfile : study.suggestedProfile} aria-label="Perfil del negocio" />
                  <div className="row">
                    <button type="submit" className="btn on">{b.aiProfile.trim() === study.suggestedProfile.trim() ? "Guardado ✓ (guardar cambios)" : "Usar este perfil"}</button>
                  </div>
                </form>
              </div>

              <section className="card">
                <h2>Cliente ideal</h2>
                <div className="cards">
                  {study.audiences.map((a, i) => (
                    <div key={i} className="study-tile">
                      <strong>{a.name}</strong>
                      <span className="small">{a.description}</span>
                      <ul className="study-list small">{a.pains.map((p, i) => <li key={i}>{p}</li>)}</ul>
                      <span className="small muted">Dónde encontrarlos: {a.channels}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card">
                <h2>Mercado local</h2>
                <p>{study.market.area}</p>
                <div className="tags">{study.market.places.map((p, i) => <span key={i} className="tag">{p}</span>)}</div>
                <div className="grid-2" style={{ gap: 18 }}>
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">Temporadas</span>
                    <ul className="study-list">{study.market.seasonality.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">Oportunidades</span>
                    <ul className="study-list">{study.market.opportunities.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                </div>
                {study.market.competitors.length > 0 && (
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">Competencia</span>
                    <ul className="study-list">{study.market.competitors.map((c, i) => <li key={i}><strong>{c.name}:</strong> {c.note}</li>)}</ul>
                  </div>
                )}
              </section>

              <section className="card">
                <div className="stack" style={{ gap: 4 }}>
                  <h2>Palabras clave para Google (SEO)</h2>
                  <p className="small muted">Lo que escribe la gente en Google para encontrar un negocio como el tuyo. La IA las usa en tus publicaciones y en los artículos de tu sitio web. Presiona Crear para hacer una publicación sobre esa búsqueda.</p>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Búsqueda</th><th>Qué quiere</th><th>Búsquedas</th><th>Competencia</th><th>Idea para publicar</th><th><span className="sr-only">Crear</span></th></tr>
                    </thead>
                    <tbody>
                      {study.keywords.map((k, i) => (
                        <tr key={i}>
                          <td><strong>{k.keyword}</strong> <span className="small muted">{k.lang.toUpperCase()}</span></td>
                          <td><span className={`pill ${INTENT[k.intent][1]}`}>{INTENT[k.intent][0]}</span></td>
                          <td><span className={`pill ${LEVEL[k.volume]}`}>{k.volume}</span></td>
                          <td><span className={`pill ${LEVEL[k.difficulty]}`}>{k.difficulty}</span></td>
                          <td className="small">{k.idea}</td>
                          <td><Link href={create(`${k.idea}\nPalabra clave: ${k.keyword}`)} className="btn link">Crear</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card">
                <h2>Ideas de campaña</h2>
                <p className="small muted">Listas para usar. Crear con IA escribe el texto para cada red y hace la foto con tu marca; desde ahí también puedes convertir la foto en video.</p>
                <div className="cards">
                  {study.campaigns.map((c, i) => (
                    <article key={i} className="study-tile">
                      <strong>{c.title}</strong>
                      <span className="small muted">Para: {c.audience}</span>
                      <span className="study-hook">“{c.hook}”</span>
                      <span className="small">{c.message}</span>
                      <span className="small"><strong>Video:</strong> {c.video}</span>
                      <div style={{ marginTop: "auto" }}><Link href={create(campaignIdea(c))} className="btn ai">✦ Crear con IA</Link></div>
                    </article>
                  ))}
                </div>
              </section>

              <div className="grid-2">
                <section className="card">
                  <h2>Pilares de contenido</h2>
                  <p className="small muted">De qué hablar y cuánto. El plan semanal con IA los sigue.</p>
                  {study.pillars.map((p, i) => (
                    <div key={i} className="stack" style={{ gap: 4 }}>
                      <div className="row between"><strong>{p.name}</strong><span className="small muted">{Math.round(p.share)}%</span></div>
                      <span className="meter"><span style={{ width: `${Math.min(100, Math.max(0, p.share))}%` }} /></span>
                      <span className="small muted">{p.description}</span>
                    </div>
                  ))}
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">Estilo de fotos y videos</span>
                    <p className="small">{study.visualStyle}</p>
                  </div>
                </section>
                <section className="card">
                  <h2>Anuncios pagados</h2>
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">Público para Facebook e Instagram</span>
                    <p className="small">{study.ads.metaAudience}</p>
                  </div>
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">Palabras clave para Google Ads</span>
                    <div className="tags">{study.ads.googleKeywords.map((k, i) => <span key={i} className="tag">{k}</span>)}</div>
                  </div>
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="lbl">Palabras negativas (para no pagar clics inútiles)</span>
                    <div className="tags">{study.ads.negativeKeywords.map((k, i) => <span key={i} className="tag neg">−{k}</span>)}</div>
                  </div>
                  <p className="small muted">{study.ads.budgetTip}</p>
                </section>
              </div>

              <div className="grid-2">
                <section className="card">
                  <h2>Dudas de tus clientes</h2>
                  {study.objections.map((o, i) => (
                    <div key={i} className="stack" style={{ gap: 2 }}>
                      <strong>{o.objection}</strong>
                      <span className="small muted">{o.answer}</span>
                    </div>
                  ))}
                </section>
                <section className="card">
                  <h2>Lo que la IA nunca dirá</h2>
                  <ul className="study-list">{study.avoid.map((a, i) => <li key={i}>{a}</li>)}</ul>
                  <p className="note">{study.caveats}</p>
                  {study.sources.length > 0 && (
                    <details>
                      <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>Fuentes que consultó la IA ({study.sources.length})</summary>
                      <ul className="study-list small" style={{ marginTop: 8 }}>
                        {study.sources.map((s, i) => <li key={i}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a></li>)}
                      </ul>
                    </details>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
