"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MoreIdeasResult } from "@/app/actions-ideas";
import { useT } from "@/components/I18n";
import { IdeaList } from "@/components/IdeaList";
import type { ContentIdea, IdeasBasis } from "@/lib/content-ideas";

/**
 * La caja grande del Inicio: eliges una idea de hoy (según tu SEO) o escribes la tuya, y la IA hace todo en la
 * página de Publicar. Con la caja vacía, "Crear con IA" usa la mejor idea del día.
 */
export function MagicPrompt({
  businessId,
  ideas,
  basis,
  enabled,
  more,
}: {
  businessId: string;
  ideas: ContentIdea[];
  basis: IdeasBasis;
  enabled: boolean;
  more: (() => Promise<MoreIdeasResult>) | null;
}) {
  const router = useRouter();
  const { t } = useT();
  const [idea, setIdea] = useState("");
  const [going, setGoing] = useState(false);
  const go = (text: string) => {
    const theIdea = text.trim() || ideas[0]?.idea || "";
    if (!theIdea) return;
    setGoing(true);
    router.push(`/b/${businessId}/publicar?${new URLSearchParams({ idea: theIdea, magic: "1" })}`);
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
        <label htmlFor="magic-idea" className="sr-only">{t("¿Qué quieres publicar hoy?", "What do you want to post today?")}</label>
        <textarea
          id="magic-idea"
          rows={2}
          value={idea}
          disabled={!enabled}
          placeholder={
            enabled
              ? t("Escribe tu idea (opcional)", "Type your idea (optional)")
              : t("Falta configurar la IA en la app", "AI isn't set up in the app yet")
          }
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              go(idea);
            }
          }}
        />
        <button type="submit" className="btn ai" disabled={!enabled || going || (!idea.trim() && !ideas.length)}>
          {going ? t("Abriendo…", "Opening…") : t("Crear con IA", "Create with AI")}
        </button>
      </div>
      {enabled && <IdeaList ideas={ideas} basis={basis} variant="hero" onPick={(x) => go(x.idea)} more={more} disabled={going} seoHref={`/b/${businessId}/seo`} />}
    </form>
  );
}
