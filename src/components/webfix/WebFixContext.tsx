"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { FixView } from "@/lib/webfix-shape";

/** Lo que comparten los botones «Arréglalo por mí» y el panel de revisión de la página de SEO. */
export type WebFixCtx = {
  businessId: string;
  /** Hay repositorio y llave en Conexiones → Sitio web. */
  connected: boolean;
  repo: string;
  fileBudget: number;
  aiReady: boolean;
  job: FixView | null;
  setJob: (job: FixView | null) => void;
  /** El enlace al panel de revisión (pestaña «Tu página web»). */
  reviewHref: string;
};

const Ctx = createContext<WebFixCtx | null>(null);

type Props = {
  businessId: string;
  connected: boolean;
  repo: string;
  fileBudget: number;
  aiReady: boolean;
  initialJob: FixView | null;
  children: React.ReactNode;
};

export function WebFixProvider({ businessId, connected, repo, fileBudget, aiReady, initialJob, children }: Props) {
  const [job, setJob] = useState<FixView | null>(initialJob);
  const value = useMemo<WebFixCtx>(
    () => ({ businessId, connected, repo, fileBudget, aiReady, job, setJob, reviewHref: `/b/${businessId}/seo?tab=web#arreglos` }),
    [businessId, connected, repo, fileBudget, aiReady, job],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** null fuera de la página de SEO (ahí no se muestra «Arréglalo por mí»). */
export function useWebFix(): WebFixCtx | null {
  return useContext(Ctx);
}
