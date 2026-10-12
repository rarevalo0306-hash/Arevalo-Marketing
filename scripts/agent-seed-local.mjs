// Synthetic fixtures only. This script deliberately refuses any other database.
import { PrismaClient } from '@prisma/client';
const url=process.env.DATABASE_URL??'';
if(!/^postgresql:\/\/[^@]+@127\.0\.0\.1:55439\/matya_agent$/.test(url))throw new Error('Only the isolated MATYA local database is allowed');
const db=new PrismaClient();
const org=await db.organization.upsert({where:{id:'matya-demo-org'},create:{id:'matya-demo-org',name:'MATYA local fixture'},update:{}});
for(const [id,name,industry,timezone,aiProfile,color] of [
 ['matya-demo-fl','Ricardo PA · prueba local','public-adjusting-fl','America/New_York','Ayudamos a propietarios de Florida con daños a su propiedad. Datos sintéticos para validar MATYA.','#146d88'],
 ['matya-demo-ni','Fameseg · prueba local','commercial-security-ni','America/Managua','Instalación y mantenimiento de cortinas metálicas en Nicaragua. Datos sintéticos para validar MATYA.','#166d58'],
]) {
 await db.business.upsert({where:{id},create:{id,name,timezone,aiProfile,color,organizationId:org.id},update:{}});
 await db.agentWorkspace.upsert({where:{businessId:id},create:{businessId:id,industry,enabled:true,allowPublish:false,objective:'Educar a nuestros clientes con contenido útil y verificable.',memory:'Español claro, tono profesional y cercano. No inventar promesas, cifras ni descuentos.',dailyBudgetCents:0,runBudgetCents:0},update:{}});
}
await db.$disconnect();console.log('Two local fixture businesses ready. No provider connections or paid calls.');
