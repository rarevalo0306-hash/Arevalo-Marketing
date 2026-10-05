import { deleteBusiness, getUploadUrl, updateAiSettings, updateBranding, updateBusiness } from "@/app/actions";
import { BrandForm } from "@/components/BrandForm";
import { usesSupabaseStorage } from "@/lib/media";
import { PageHead } from "@/components/PageHead";
import { availableText } from "@/lib/ai";
import { db } from "@/lib/db";
import { availableImage } from "@/lib/imagegen";

export default async function NegocioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await db.business.findUniqueOrThrow({ where: { id } });
  return (
    <>
      <PageHead business={b} prefix="Ajustes de" title="Ajustes del negocio" />
      <div className="grid-2">
        <form action={updateBusiness.bind(null, id)} className="card">
          <h2>Datos</h2>
          <div className="stack"><label className="lbl" htmlFor="name">Nombre</label><input id="name" name="name" className="field" defaultValue={b.name} required /></div>
          <div className="stack"><label className="lbl" htmlFor="website">Sitio web</label><input id="website" name="website" type="url" className="field" defaultValue={b.website} placeholder="https://" /></div>
          <div className="stack"><label className="lbl" htmlFor="color">Color</label><input id="color" name="color" type="color" defaultValue={b.color} style={{ width: 80, height: 44, border: 0, padding: 0, background: "none" }} /></div>
          <div><button className="btn on" type="submit">Guardar</button></div>
        </form>
        <BrandForm
          logoUrl={b.logoUrl}
          phone={b.phone}
          brandImages={b.brandImages}
          color={b.color}
          save={updateBranding.bind(null, id)}
          upload={usesSupabaseStorage() ? getUploadUrl.bind(null, id) : null}
        />
        <form action={updateAiSettings.bind(null, id)} className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>Agente de IA</h2>
          <p className="small muted">Cuéntale a la IA sobre tu negocio. Solo usará estos datos: no inventa precios, teléfonos ni resultados.</p>
          <div className="stack">
            <label className="lbl" htmlFor="aiProfile">Sobre el negocio</label>
            <textarea
              id="aiProfile"
              name="aiProfile"
              className="field"
              maxLength={4000}
              defaultValue={b.aiProfile}
              placeholder="Ej.: Somos ajustadores públicos con licencia en Florida. Ayudamos a dueños de casa con reclamos por huracán, agua, fuego y techo. Hablamos español e inglés. Teléfono: … Evaluación inicial gratis. Zona: Miami-Dade y Broward."
            />
          </div>
          <div className="row" style={{ gap: 16 }}>
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl" htmlFor="aiText">IA para escribir</label>
              <select id="aiText" name="aiText" className="field" defaultValue={b.aiText}>
                <option value="">Automático</option>
                {availableText().map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <label className="lbl" htmlFor="aiImage">IA para fotos</label>
              <select id="aiImage" name="aiImage" className="field" defaultValue={b.aiImage}>
                <option value="">Automático</option>
                {availableImage().map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <label className="check">
            <input type="checkbox" name="aiAutopublish" defaultChecked={b.aiAutopublish} style={{ marginTop: 4 }} />
            <span>
              <strong>Publicar automáticamente lo que planee la IA</strong>
              <span className="small muted" style={{ display: "block" }}>Si lo activas, el plan semanal sale solo, sin que lo revises. Recomendado: déjalo apagado hasta que confíes en lo que escribe.</span>
            </span>
          </label>
          <div><button className="btn on" type="submit">Guardar</button></div>
        </form>
        <form action={deleteBusiness.bind(null, id)} className="card">
          <h2>Borrar negocio</h2>
          <p className="small muted">Se borran sus conexiones, contactos e historial en esta app. No se borra nada de Facebook, Instagram ni de tus otras cuentas.</p>
          <div className="stack">
            <label className="small" style={{ fontWeight: 500 }} htmlFor="confirm">Escribe &quot;{b.name}&quot; para confirmar</label>
            <input id="confirm" name="confirm" className="field" autoComplete="off" />
          </div>
          <div><button className="btn danger" type="submit">Borrar negocio</button></div>
        </form>
      </div>
    </>
  );
}
