"use client";
import { useEffect } from "react";

/** Editor-only typefaces: normal navigation never waits for these fonts. */
export function DesignFonts() {
  useEffect(() => {
    if (document.getElementById("matya-design-fonts")) return;
    const link = document.createElement("link");
    link.id = "matya-design-fonts";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Montserrat:wght@800&family=Poppins:wght@800&family=Inter:wght@800&family=Oswald:wght@700&family=Playfair+Display:wght@800&display=swap";
    document.head.appendChild(link);
  }, []);
  return null;
}
