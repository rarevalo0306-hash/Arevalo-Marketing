// «Tu identidad»: las 3 direcciones que propone la IA (o lo que trae el manual) y el eslogan, los mensajes, la voz,
// la música y el estilo de fotos. Aquí se cargan los datos; lo que se ve y se toca está en IdentityProposals e
// IdentityForm.
import { chooseIdentity, proposeIdentities, saveIdentity } from "@/app/actions-brand-identity";
import { aiEnabled } from "@/lib/ai";
import { readBrandIdentity, withSeeds } from "@/lib/brand-identity-shape";
import { db } from "@/lib/db";
import { readStudy } from "@/lib/study-shape";
import { IdentityForm } from "./IdentityForm";
import { IdentityProposals } from "./IdentityProposals";

export async function IdentitySection({ businessId }: { businessId: string }) {
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { brandIdentity: true, brandBookUrl: true, aiProfile: true, study: true },
  });
  if (!b) return null;
  const identity = withSeeds(readBrandIdentity(b.brandIdentity), { aiProfile: b.aiProfile, avoid: readStudy(b.study)?.avoid });
  const aiOn = aiEnabled();
  return (
    <>
      <IdentityProposals
        proposals={identity.proposals}
        chosen={identity.chosenProposal}
        hasBook={Boolean(b.brandBookUrl)}
        source={identity.source}
        aiOn={aiOn}
        propose={proposeIdentities.bind(null, businessId)}
        choose={chooseIdentity.bind(null, businessId)}
      />
      <IdentityForm identity={identity} aiOn={aiOn} save={saveIdentity.bind(null, businessId)} />
    </>
  );
}
