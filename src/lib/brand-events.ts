// Aviso en el navegador cuando el dueño guarda la marca: el kit y las plantillas se vuelven a crear solos.
export type BrandSaved = { businessId: string; /** Cambiaron colores, letras o logos (o todavía no hay kit). */ visual: boolean };

const EVENT = "brand:saved";

export function emitBrandSaved(detail: BrandSaved) {
  window.dispatchEvent(new CustomEvent<BrandSaved>(EVENT, { detail }));
}

export function onBrandSaved(cb: (d: BrandSaved) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<BrandSaved>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
