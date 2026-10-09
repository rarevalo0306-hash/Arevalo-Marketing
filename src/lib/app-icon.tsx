import { readFile } from "fs/promises";
import path from "path";
import { ImageResponse } from "next/og";

/** Ícono de la app: una "N" blanca sobre el degradado de IA. */
export async function appIcon(size: number) {
  const bold = await readFile(path.join(process.cwd(), "src/assets/fonts/montserrat-800.woff"));
  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #2f80ff 0%, #7b5cff 55%, #19c2b5 100%)",
          color: "#fff",
          fontSize: Math.round(size * 0.52),
          fontWeight: 800,
          fontFamily: "Montserrat",
          letterSpacing: -4,
        }}
      >
        N
      </div>
    ),
    { width: size, height: size, fonts: [{ name: "Montserrat", data: bold, weight: 800, style: "normal" }] },
  );
}
