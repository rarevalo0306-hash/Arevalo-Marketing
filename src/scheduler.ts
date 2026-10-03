// Publicador automático: cuando la app corre en un servidor normal (npm start),
// revisa cada minuto si hay publicaciones programadas cuya hora ya llegó.
import { publishDue } from "@/lib/publish";

if (process.env.SCHEDULER !== "off") {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await publishDue();
    } catch (e) {
      console.error("[publicador] error:", e);
    } finally {
      running = false;
    }
  }, 60_000);
}
