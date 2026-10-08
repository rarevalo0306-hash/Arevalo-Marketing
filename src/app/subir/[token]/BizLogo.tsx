"use client";

import { useState } from "react";
import s from "./subir.module.css";

/** Logo del negocio; si no hay o no carga, la inicial sobre el color del negocio. */
export function BizLogo({ src, name }: { src: string; name: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken)
    // eslint-disable-next-line @next/next/no-img-element -- logo guardado del negocio
    return <img className={s.logo} src={src} alt="" onError={() => setBroken(true)} />;
  return (
    <span className={s.initial} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || "•"}
    </span>
  );
}
