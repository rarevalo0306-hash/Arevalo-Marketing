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
