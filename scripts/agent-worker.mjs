// Optional dedicated scheduler. Run only in a configured environment. Never prints secrets.
const target=new URL(process.env.MATYA_WORKER_URL || 'http://127.0.0.1:4182/api/cron?agent=1');
if(target.protocol!=='https:' && !['127.0.0.1','localhost'].includes(target.hostname)) throw new Error('Worker URL must use HTTPS');
if(!process.env.CRON_SECRET) throw new Error('CRON_SECRET is required');
let stop=false; process.on('SIGINT',()=>{stop=true;}); process.on('SIGTERM',()=>{stop=true;});
while(!stop) {
  try {
    const r=await fetch(target,{headers:{Authorization:`Bearer ${process.env.CRON_SECRET}`},signal:AbortSignal.timeout(295000),redirect:'error'});
    console.log(new Date().toISOString(),'MATYA worker',r.status);
  }catch{console.error('MATYA worker: connection failed');}
  if(!stop) await new Promise(r=>setTimeout(r,30000));
}
