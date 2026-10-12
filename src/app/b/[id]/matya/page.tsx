import { redirect } from "next/navigation";
import { AgentCenter } from "@/components/agent/AgentCenter";
import { requireAgentOwner } from "@/lib/agent/access";
import { snapshot } from "@/lib/agent/service";
import { pageBusiness } from "@/lib/auth";
import { roleAllows } from "@/lib/roles";
export default async function MatyaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (process.env.MATYA_AGENT_ENABLED !== "true")
    return <AgentCenter businessId={id} initial={null} />;
  // The center needs the Administrator role; other roles start on Inicio.
  const { role } = await pageBusiness(id);
  if (!roleAllows(role, "admin")) redirect(`/b/${id}/inicio`);
  await requireAgentOwner(id);
  try {
    return (
      <AgentCenter key={id} businessId={id} initial={await snapshot(id)} />
    );
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && e.code === "P2021")
      return (
        <AgentCenter
          businessId={id}
          initial={null}
          setupError="Falta aplicar la migración del centro de MATYA en este entorno."
        />
      );
    throw e;
  }
}
