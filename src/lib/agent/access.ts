import { businessAccess } from "@/lib/auth";
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
  // Only an Administrator of the business's organization (src/lib/auth.ts) runs the
  // center for now. Never accept an owner/business id from an LLM. Business ids always
  // come from authenticated routes.
  const access = await businessAccess(businessId, "admin");
  if (access.ok) return;
  if (access.status === 401)
    throw new AgentError("Vuelve a iniciar sesión.", 401);
  if (access.status === 403)
    throw new AgentError("Solo el Administrador puede usar el centro de MATYA.", 403);
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
