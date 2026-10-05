"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** La caja grande del Inicio: escribes la idea y la IA hace todo en la página de Publicar. */
export function MagicPrompt({ businessId, ideas, enabled }: { businessId: string; ideas: string[]; enabled: boolean }) {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [going, setGoing] = useState(false);
  const go = (text: string) => {
    if (!text.trim()) return;
    setGoing(true);
    router.push(`/b/${businessId}/publicar?${new URLSearchParams({ idea: text.trim(), magic: "1" })}`);
  };
  return (
    <form
      className="magic"
      onSubmit={(e) => {
        e.preventDefault();
        go(idea);
      }}
    >
      <div className="magic-input">
        <span className="spark" aria-hidden="true">✦</span>
        <label htmlFor="magic-idea" className="sr-only">¿Qué quieres publicar hoy?</label>
        <textarea
          id="magic-idea"
          rows={2}
          value={idea}
          disabled={!enabled}
          placeholder={enabled ? "Escribe una idea… la IA escribe el texto, crea la foto y le pone tu marca" : "Falta configurar la IA en la app"}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              go(idea);
            }
          }}
        />
        <button type="submit" className="btn ai" disabled={!enabled || !idea.trim() || going}>{going ? "Abriendo…" : "Crear con IA"}</button>
      </div>
      {enabled && (
        <div className="idea-chips">
          {ideas.map((t) => (
            <button key={t} type="button" className="idea-chip" onClick={() => go(t)} disabled={going}>{t}</button>
          ))}
        </div>
      )}
    </form>
  );
}
