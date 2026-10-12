# Pruebas reproducibles

`npm ci`, `npm run typecheck`, `npm test` y `npm run build` son las comprobaciones generales. El build no se conecta a proveedores para generar campañas. Las advertencias de lint que quedan son de archivos anteriores a este cambio.

La suite `agent-database.test.ts` se omite salvo que `MATYA_TEST_DATABASE_URL` sea idéntica a `DATABASE_URL` y apunte expresamente a PostgreSQL en `127.0.0.1:55439/matya_agent`. Nunca se usa la base remota configurada por accidente. Cada prueba crea y borra únicamente los negocios sintéticos `matya-it-a`/`matya-it-b`.

La plantilla `docs/agent/ci-workflow.yml.example` reproduce el esquema anterior, aplica la migración real con los roles de la Data API y ejecuta la suite completa con PostgreSQL 17. No utiliza secretos ni cuentas externas. No está instalada en GitHub: la conexión OAuth rechazó crear workflows por falta del permiso `workflow`. Para habilitar CI más adelante, un administrador puede revisar la plantilla e instalarla como `.github/workflows/matya-agent.yml` con una conexión autorizada. Las comprobaciones de esta entrega se ejecutaron localmente.

Para una prueba local equivalente:

1. Iniciar PostgreSQL en loopback, puerto 55439, base `matya_agent`, con credenciales exclusivas de prueba. En esta sesión se utilizó `embedded-postgres@18.4.0-beta.17` instalado en un directorio temporal fuera del proyecto.
2. Exportar `DATABASE_URL`, `DIRECT_URL` y `MATYA_TEST_DATABASE_URL` con la misma conexión local.
3. Extraer `prisma/schema.prisma` del commit `9e191ac89d2120ee803b73aeccc9b7a162791b99`; aplicar `prisma db push --schema <archivo> --skip-generate` **solo a la base local vacía**.
4. Crear los roles `anon` y `authenticated`, aplicar `supabase/migrations/20261012084743_matya_agent_workspace.sql`, después `supabase/migrations/20261012190000_users_organizations.sql` y `supabase/migrations/20261012230000_team_invitations.sql`, y ejecutar `npx prisma generate`.
5. Ejecutar `npm test`. La integración comprueba RLS, aislamiento, reservas concurrentes, reclamación única, recuperación, aprobación, cancelación, límites de envío, render con cotización exacta, noticias y medición insuficiente.
6. `node scripts/agent-seed-local.mjs` crea dos negocios sintéticos para revisar la interfaz. También rechaza cualquier base fuera de esa conexión local.

Los proveedores de IA, video y fuentes se simulan en las pruebas de integración. Los proyectos, presupuestos, publicaciones, estados y transacciones sí pasan por PostgreSQL real. La confirmación simulada de un canal no se presenta como publicación real. Las pruebas de voz inyectan eventos de reconocimiento/síntesis y no abren el micrófono.
