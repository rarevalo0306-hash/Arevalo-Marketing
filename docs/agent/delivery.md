# Entrega del plan MATYA

12 de octubre de 2026. Versión integrada del PR #57 lista para publicación; incluye seguridad #55 y privacidad #56. Migraciones remotas aplicadas y centro habilitado para ambos negocios con gasto cero y publicación desactivada. La confirmación final de despliegue se registra en GitHub/Vercel tras verificar la app.

| Fase | Entregado en código | Validación o pendiente real |
| --- | --- | --- |
| Rendimiento y estados | Solo la pestaña SEO activa se serializa; tipografías de diseño se cargan en sus editores; diario durable de trabajos, bloqueos y errores | Diagnóstico envía 47–62 % menos contenido HTTP en la comparación local. No se atribuye esa mejora a toda la aplicación ni al tiempo de carga en producción. |
| Centro e industria | Conversación, resumen con datos del negocio, memoria y hechos con fuente/territorio/vigencia, catálogo de herramientas | Dos negocios sintéticos aislados, guardado y recarga verificados. Cambiar de industria excluye los hechos del territorio anterior. |
| Especialistas y campañas | Investigación contextual, variantes de texto, diseños, video con recursos propios, campaña y confirmación por canal; reservas y límites; aprobación opcional | PostgreSQL real con proveedores simulados. Falta ejecutar con los proveedores y canales autorizados del piloto. |
| Voz | Micrófono explícito, respuesta del mismo encargo, silencio separado de cancelación | Reconocimiento/síntesis simulados en Chrome; pendiente prueba acústica y aceptación en dispositivos reales. |
| Noticias | RSS/Atom, fuente primaria, fecha del hecho, verificación y detección de cambios; contenido original a partir de noticias verificadas | Se probaron propuestas legales, contradicciones y caducidad. Los feeds reales y permisos de cualquier recurso externo se validan antes del piloto. |
| Optimización | Umbrales de evidencia, métricas de la campaña y propuestas reversibles de horario/formato | Pendiente ventana real de al menos siete días. No se afirma una mejora de conversiones o rendimiento comercial. |

## Evidencia final local

- 97 archivos de pruebas; **1.664 pruebas aprobadas, ninguna omitida**, incluida integración PostgreSQL.
- `npm run typecheck`: correcto.
- `npm run build`: correcto; conserva advertencias anteriores de otros archivos y la advertencia de raíz inferida de Next en este checkout anidado.
- Navegador: sin errores JavaScript, móvil de 390 px sin desbordamiento, guardado persistente, un solo panel SEO, enlace antiguo de SEO, rechazo de origen cruzado y worker protegido. Voz simulada: un encargo y una respuesta; silenciar no cancela el trabajo.
- GitHub rechazó instalar CI por falta del permiso OAuth `workflow`; su configuración queda revisable en `ci-workflow.yml.example`, sin solicitar ni modificar credenciales. No se afirma una ejecución de CI remota.
- Revisión visual de confirmación: los cuatro hallazgos quedaron resueltos; disposición `ship` para esas correcciones.

La web pública y el agente 3D están conservados. El respaldo privado en Drive incluye el plan, ambos brand books, código y assets de la web.

## Antes de activar

Seguridad, privacidad y migraciones ya están incorporadas. Para activar tareas de pago y automatización continua, seguir [README.md](README.md): configurar proveedor/tarifas/worker y los límites del piloto. No abrir cuentas de clientes externos con la sesión compartida del dueño. La rama desactiva su despliegue automático y parte de presupuesto cero/publicación desactivada.

No se han realizado llamadas de pago ni publicaciones reales para producir esta evidencia. Las dependencias del piloto son trabajo pendiente de activación y observación, no resultados sustituidos por simulaciones.
