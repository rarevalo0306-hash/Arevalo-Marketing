# Centro MATYA: implementación y operación

12 de octubre de 2026. Versión de publicación del PR #57, basada en `9e191ac` e integrando los PR #55 (seguridad) y #56 (privacidad). La web pública y su agente 3D no cambian. Las migraciones remotas ya están aplicadas; el despliegue se verifica por separado en Vercel y en el navegador. No se ha publicado contenido en redes.

## Qué ejecuta esta versión

- Centro `/b/[id]/matya`: conversación, conocimiento editable, fuentes, noticias, resultados, configuración y registro real de especialistas. El resumen funciona sin una llamada de pago.
- Investigación/SEO usa el estudio, la identidad, objetivos, memoria, conocimiento vigente y noticias contrastadas. No representa ese contexto como una búsqueda abierta en tiempo real.
- Redacción produce variantes para Facebook, Instagram, Google Business Profile, LinkedIn, X y web; guion original y texto alternativo. Los formatos de video agregan YouTube/TikTok a través de los publicadores existentes. Solo se programan canales conectados y compatibles.
- Diseño produce tres piezas con plantillas y recursos de la marca, más sus metadatos. El video solicitado utiliza esas piezas propias y el render existente. Música apagada; no se extraen clips de terceros. La primera integración es video vertical corto, no documentales ni narración de larga duración.
- Una campaña por encargo atraviesa investigación, redacción, diseño, preparación, programación y confirmación por canal. La confirmación del proveedor se muestra como tal; no se confunde con comprobar una web desplegada.
- Radar RSS/Atom por industria/territorio. Registra fechas, procedencia, cambios y clave de noticia; contrasta el artículo primario con fragmentos verificables. No interpreta una propuesta legal como una ley vigente. Crear contenido desde una noticia requiere verificación reciente.
- Voz mediante reconocimiento y síntesis del navegador, con indicador de escucha, cierre del micrófono, interrupción y el mismo endpoint/contexto que el texto. El servicio depende del navegador. No se seleccionó ni contrató una voz comercial; calidad en dispositivos reales sigue siendo parte del piloto.
- Optimización: al menos siete días, tres publicaciones distintas medidas, mil impresiones y mediciones de menos de tres días. Las propuestas de horario/formato usan datos de la misma campaña, IDs deterministas y el sistema reversible existente. Autoaplicar exige modo automático y el permiso ya configurado en la campaña. No aumenta gasto ni atribuye conversiones a interacciones.

Las demás herramientas del catálogo siguen accesibles. La conversación no ofrece ejecución arbitraria de cualquier operación de la app: las acciones disponibles están delimitadas por el servidor.

## Estados y recuperaciones

`queued → running → queued/completed`, o `waiting_approval`, `waiting_provider`, `blocked`, `uncertain`, `cancelled`. Cada paso guarda entrada de contexto, resultado, consumo y especialista. Los pasos largos sobreviven a cerrar el navegador.

Una fila Business bloqueada con `FOR UPDATE` serializa cambios de política, reservas y publicación del mismo negocio. La clave de petición evita encargos duplicados; un lease y un cambio atómico de estado impiden ejecutar dos veces el mismo paso. Un resultado externo desconocido **no** se reintenta automáticamente: retiene conservadoramente su reserva como consumo y queda por revisar. Eso puede sobreestimar gasto, nunca demuestra un cobro efectivo. No se promete entrega exactamente una vez si un proveedor procesa una solicitud y se pierde su respuesta.

El publicador común vuelve a comprobar política, revisión del contexto, conexiones, cancelación, estado de la campaña, frescura de noticia y cupo del día del envío. El cron anterior no puede saltar ese control para posts con el prefijo reservado `agent-`. El motor antiguo excluye las campañas propiedad de estos encargos. Cancelar revierte solo publicaciones aún sin reclamar; una llamada ya enviada a una red puede terminar.

## Alcance de presupuestos

### Primero la biblioteca de cada compañía

El agente busca material adecuado en la biblioteca del negocio antes de preparar diseños o videos. Usa la relevancia temática y los filtros existentes de calidad, privacidad y «No usar»; solo selecciona archivos de esa compañía. Los diseños adaptan una foto reutilizada a tres formatos con las plantillas de marca; los videos montan fotos y clips de la biblioteca. Si no hay material adecuado, recurre a diseños de marca sin generar imágenes o escenas nuevas con IA. La selección no llama a un modelo de pago ni busca archivos externos.

Cada paso registra `mediaSelection` con la política, procedencia y archivos elegidos, y muestra un resumen del material utilizado. Generar desde cero queda como propuesta excepcional para una herramienta con presupuesto propio; este flujo no activa generación de imágenes/video ni usa los proveedores antiguos como respaldo automático. El montaje sigue sujeto a las reservas y topes del agente. La corrección pendiente del registro de costos inciertos es independiente de esta política.

### Qué cubren los límites

Los topes nuevos cubren las llamadas de texto del agente y una reserva conservadora del máximo configurado por render. Cada solicitud de texto hace una sola llamada: no hay fallback/reintento de pago oculto. Una tarifa ausente bloquea la tarea; respuesta sin uso verificable conserva la reserva.

No es todavía una factura consolidada de toda la plataforma: herramientas anteriores, anuncios, almacenamiento y cómputo de infraestructura mantienen sus controles/facturas propios. El agente no puede aumentar esos presupuestos. El modo de aprobación no amplía límites ni conecta cuentas.

## Modo equipo

16 de octubre de 2026. Con el modo equipo encendido, MATYA trabaja como un equipo de agentes. Lo que pide el dueño va al equipo, también una pregunta (el Director la contesta sin crear piezas). Solo siguen como antes el resumen, la pausa de una campaña, el radar y contrastar una noticia. Con el modo apagado, todo funciona exactamente como antes.

**Quién hace qué.** El Director decide la meta y cuántas piezas hacen falta. SEO e investigación lee los reportes de SEO ya guardados y las noticias verificadas; nunca vuelve a medir. Estrategia propone las piezas. MATYA (código, sin IA) revisa cada propuesta contra los límites y crea una pieza por cada una válida. En cada pieza, Redacción escribe, Diseño arma las imágenes (primero la biblioteca del negocio, si no hay, plantillas de marca; nunca una imagen nueva con IA), Video cotiza, Revisión editorial revisa, y MATYA prepara, programa y confirma. Cada agente solo usa sus herramientas y solo trabaja con el negocio del encargo. Lo que viene de webs, noticias o mensajes es dato, nunca instrucción.

### Cómo encenderlo

1. Aplicar la migración `supabase/migrations/20261016120000_matya_team.sql` en Supabase **antes** de desplegar este código (ver `docs/agent/testing.md`). Es aditiva, pero Prisma lee todas las columnas.
2. MATYA debe estar activa: `MATYA_AGENT_ENABLED=true`, MATYA encendida en la configuración, con presupuesto diario y por trabajo, canales y permiso de publicación.
3. En la configuración del negocio:
   - `teamMode`: encendido.
   - `dailyHour`: la hora del plan de la mañana (0 a 23), en la hora del negocio. Cada día, a esa hora, el equipo recibe un encargo «Plan del día» con las señales del día. Uno solo por día local, también el día del cambio de horario: se mira el reloj de pared del negocio.
   - `agentModels`: el proveedor y el modelo de cada agente que use IA (Director, SEO, Estrategia, Redacción y Revisión). Un agente sin modelo propio usa el de `MATYA_AGENT_*`. Diseño y Video no usan modelo.
   - `modelPrices`: el precio verificado de cada modelo, en dólares por millón de tokens, con la clave `proveedor:modelo` (por ejemplo `openai:gpt-x` → `{ input, output }`).
   Las pantallas para estas opciones llegan después (PR 2). Mientras tanto se guardan con la acción `settings` del Centro; guardar desde la pantalla actual las conserva.
4. El llamado de cada minuto debe estar activo (`node scripts/agent-worker.mjs` o el planificador con `/api/cron?agent=1`, ver «Activación, en orden»). Sin él no avanza ningún paso ni llega el plan de la mañana.

**Dinero.** Antes de cada paso con IA se reserva lo más que puede costar una llamada de ese modelo, y el agente llama con ese mismo modelo y ese precio: el cobro nunca pasa de la reserva. Cada paso hace una sola llamada de pago; nunca reintenta ni cambia de modelo o de proveedor. Si a un modelo le falta el precio verificado, o a su proveedor la clave, la pieza queda bloqueada con un mensaje claro («Falta el precio verificado…», «Falta la conexión del modelo…»), sin reservar ni cobrar nada. Si un paso falla antes de hacer su llamada, su reserva se libera. Si falla después, la reserva se cobra y el paso queda por revisar, como siempre.

### Pausar todo y Reanudar

«Pausar todo» (acción `pause_all`) detiene al equipo de una vez: no se acepta trabajo nuevo, ni del dueño ni del plan de la mañana, se cancela todo lo abierto y lo programado que aún no salió vuelve a borrador. Un paso que ya está corriendo termina, pero ninguno empieza después. Una publicación que ya se envió a una red no se puede deshacer. «Reanudar» (`resume_all`) acepta trabajo otra vez; lo cancelado sigue cancelado. Si la pausa canceló el plan de la mañana, ese día no se repite: llega el del día siguiente. Además, antes de cada paso del equipo se revisa que MATYA no esté en pausa ni apagada y que el modo equipo siga encendido: si el dueño apaga algo a mitad de un plan, el paso siguiente no empieza y no se reserva nada.

### Lo que espera al dueño

Estas piezas quedan en «Necesita tu sí» (`waiting_approval`) y no siguen hasta que el dueño apruebe, pida «Rehacer» o cancele:

- **El costo del video.** El video se cotiza primero; el render empieza solo con la aprobación de ese precio, y cobra exactamente lo cotizado. No pasa del máximo por video ni del tope de videos del día.
- **El borrador de un artículo para la web.** Paga Google y la IA del negocio: el dueño aprueba un «hasta US$X» antes de escribirlo. Una vuelta de corrección es otro borrador y pide su propia aprobación.
- **Las fotos con IA.** Si ninguna foto de la biblioteca va con un artículo, crearla con IA espera la aprobación de su precio. Sin ella no se genera ninguna imagen.
- **Una revisión que falla.** La pieza tiene una sola vuelta de corrección automática; si vuelve a fallar, espera al dueño con las notas. Un artículo que falla espera al dueño de una vez, porque corregirlo es otro borrador de pago.
- **El modo aprobación.** Con `mode: "approval"`, cada pieza que pasa la revisión espera la aprobación del dueño. Solo cuenta una aprobación dada después de la revisión (aprobar el costo de un video no aprueba la publicación).

Sin permiso de publicación, una pieza lista espera en su paso de programar.

### Límites que siempre aplican

- **Nunca YouTube.** El agente no publica en YouTube: el validador descarta esas piezas y el guardia lo rechaza al programar. Esa subida siempre la aprueba una persona.
- **Tope diario de publicaciones** (`maxPostsPerDay`): lo comparten las piezas y las campañas de antes, y un artículo publicado cuenta como una. Se revisa dentro del candado del negocio al programar: dos piezas a la vez nunca lo pasan juntas.
- **Ocho trabajos abiertos como máximo**, contando el encargo del equipo y cada una de sus piezas. El despacho solo crea las piezas que caben.
- **Canales:** solo los permitidos y conectados. Un canal cuyos dos últimos envíos fallaron queda frenado hasta que el dueño vuelva a guardar su conexión.
- **Ventanas de tormenta** (Florida 626.854): cuando un encargo trae una tormenta (`context.storm`), primero va el contenido de seguridad. Sus piezas salen entre las 9 a. m. y las 7 p. m. de la hora del negocio, aunque la tormenta ya sea vieja; una oferta de servicios, como pronto 49 horas después del evento y nunca en domingo. Hoy ninguna fuente pone `context.storm` sola: la campaña manual de tormenta sigue siendo la que aplica esos tiempos.

## Activación, en orden

1. Seguridad PR #55 y privacidad PR #56 integrados en esta versión. Sus ramas fuente y `APP_SECRET` se conservaron. Aplicadas las migraciones `matya_agent_workspace` y `matya_login_security_release` en Matya; verificadas las siete tablas privadas, la columna de Campaign y la revocación de ejecución pública de `rls_auto_enable`.
2. Probar la migración `supabase/migrations/20261012084743_matya_agent_workspace.sql` en un entorno privado. Es aditiva: seis tablas, relación identificadora en Campaign e índices. Las tablas nuevas tienen RLS y sin permisos para `anon`/`authenticated`. **Aplicar antes del código**, aunque el feature flag esté apagado, porque el cliente Prisma también conoce la columna nueva de Campaign.
3. Mantener `MATYA_AGENT_ENABLED=false` durante la preparación. Elegir proveedor/modelo compatible con JSON y establecer tarifas vigentes en las variables de `.env.example`, con la clave ya existente del proveedor. No modificar ni copiar secretos entre entornos.
4. Habilitar el flag en el entorno de piloto, configurar industria/objetivo/fuentes y límites por negocio. De fábrica: presupuesto $0 y publicación desactivada. Definir alcance, canales, frecuencia y presupuesto reales del piloto antes de permitir gasto/envío.
5. Ejecutar `node scripts/agent-worker.mjs` en un proceso persistente, con `MATYA_WORKER_URL=https://<app>/api/cron?agent=1` y el `CRON_SECRET` del entorno. Alternativamente invocar ese endpoint cada minuto desde el planificador contratado. El script espera 30 segundos entre ciclos y nunca superpone sus propias solicitudes. La ruta exacta `/api/cron` es compatible con el gate de PR #55; `?agent=1` evita ejecutar los trabajos de pago antiguos en cada tick. El cron diario actual permanece igual.
6. Mantener el trabajo existente de sincronización de métricas. Verificar ambos pilotos internos, observar al menos siete días antes de atribuir mejoras y registrar fallos parciales por canal.

El centro queda habilitado en producción para los dos negocios existentes, con industria correspondiente, presupuesto cero y publicación desactivada. Proveedor/tarifas y worker frecuente quedan pendientes de la activación operativa del piloto. El resumen usa datos del negocio sin una llamada de pago. La rama desactiva su despliegue automático en `vercel.json`; publicar se hace desde main. No activa un worker remoto ni cambia planes de Vercel. La autenticación sigue siendo la del dueño compartido; **no habilitar clientes externos** hasta implementar cuentas, membresías y autorización por organización.

## Reversión

Apagar `MATYA_AGENT_ENABLED` y detener el worker. Las publicaciones del agente quedan protegidas por el guard común. Para volver al código anterior, **primero** cancelar los encargos y pasar sus posts programados a borrador mientras ese guard sigue instalado; el publicador de la versión anterior no lo tiene. Mantener las tablas y la columna aditivas para conservar el registro. Revisar manualmente cualquier publicación ya en vuelo. No borrar reservas o registros para forzar un reintento.

## Validación y límites de la entrega

- Suite existente, TypeScript y build de producción; integración adicional con PostgreSQL local en loopback.
- Pruebas de dos industrias aisladas; idempotencia concurrente, presupuestos, leases interrumpidos, cancelación, aprobación, revisión de política, video, RLS, noticias viejas/cambiadas/contradictorias, y ausencia de datos suficientes para optimizar.
- Pruebas de interfaz, teclado/enlaces de Diagnóstico, guardado de conocimiento, contextos separados y rechazo de orígenes ajenos. La voz se comprueba con eventos simulados; no equivale a una prueba acústica del micrófono del dueño.
- Comparación reproducible de respuesta HTTP: ver `performance-local.json`. Ambos builds de producción, misma base local sintética, seis solicitudes tibias alternadas por ruta y una de calentamiento descartada. Son medidas locales de respuesta completa, **no FCP ni una promesa de latencia en producción**. Inicio apenas cambia (22 → 21 ms); Diagnóstico Resumen 25 → 18 ms y 117.726 → 61.935 bytes; Posiciones 24 → 12 ms y 117.680 → 44.469 bytes.

Pendientes que requieren el entorno/piloto real: configuración y tarifas definitivas de proveedor, ejecución real de IA/render/redes, aceptación de voz en dispositivos, revisión de feeds elegidos por industria, métricas de conversiones y ventana de observación. No se ha fingido ninguno de esos resultados.

## Referencias de implementación

- [RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [Transacciones de Prisma](https://www.prisma.io/docs/orm/fundamentals/transactions).
- [Trabajo después de la respuesta en Next](https://nextjs.org/docs/app/api-reference/functions/after).
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API).
- [Despliegue por rama de Vercel](https://vercel.com/docs/project-configuration/git-configuration).
