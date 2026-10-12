import { cookies } from "next/headers";
import { safeEqual, SESSION_COOKIE, sessionToken } from "@/lib/session";
import { db } from "@/lib/db";
export class AgentError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function requireAgentOwner(businessId: string) {
  if (process.env.MATYA_AGENT_ENABLED !== "true")
    throw new AgentError(
      "El centro de MATYA aún no está activado en este entorno.",
      503,
    );
  if (
    !process.env.APP_PASSWORD ||
    !process.env.APP_SECRET ||
    !safeEqual(
      (await cookies()).get(SESSION_COOKIE)?.value ?? "",
      await sessionToken(),
    )
  )
    throw new AgentError("Vuelve a iniciar sesión.", 401);
  // Current product has a single owner session, not client memberships. Never accept
  // an owner/business id from an LLM. Business ids always come from authenticated routes.
  if (
    !/^[a-zA-Z0-9_-]{1,100}$/.test(businessId) ||
    !(await db.business.findUnique({
      where: { id: businessId },
      select: { id: true },
    }))
  )
    throw new AgentError("Negocio no encontrado.", 404);
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  // Next can construct req.url with its internal localhost address. The Host
  // header is the browser's actual destination; an external Origin must match it.
  const expected = new URL(req.url);
  const host = req.headers.get("host");
  if (host) expected.host = host;
  if (
    !origin ||
    origin !== expected.origin ||
    req.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new AgentError("Origen de la solicitud no permitido.", 403);
}
