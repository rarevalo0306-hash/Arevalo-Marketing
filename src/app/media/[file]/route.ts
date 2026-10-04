import { readFile } from "fs/promises";
import path from "path";
import { MEDIA_CONTENT_TYPES, SAFE_MEDIA_NAME, UPLOAD_DIR } from "@/lib/media";

// Público a propósito: Instagram, TikTok y Google descargan aquí las fotos y videos.
export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!SAFE_MEDIA_NAME.test(file)) return new Response("No encontrado", { status: 404 });
  try {
    const data = await readFile(path.join(UPLOAD_DIR, file));
    const ext = file.split(".").pop()!;
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": MEDIA_CONTENT_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
}
