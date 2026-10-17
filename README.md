# Matya

App de marketing para manejar varios negocios desde un solo lugar: estudia cada negocio, revisa cómo sale en Google y en las IAs, arma la marca, crea y publica en todos los canales, y mide los resultados. Está en español e inglés y se puede instalar en el celular.

- **La app:** `app.matya.app` (este repositorio, en Vercel).
- **La web pública** `matya.app` y su agente 3D son otro proyecto. Ahí están las páginas de privacidad, condiciones y borrado de datos que enlaza la app.

> El repositorio conserva su nombre original, `Arevalo-Marketing`.

## Qué hace

El menú de cada negocio está ordenado por fases de trabajo:

- **Centro MATYA.** Un agente de IA con el que hablas por texto o por voz. Conoce el negocio y su industria. Investiga, escribe, diseña y arma videos con las fotos y clips de la biblioteca del negocio, sin inventar escenas con IA. Lee noticias de la industria (RSS) guardando la fuente y la fecha. Cada negocio tiene su presupuesto y su permiso para publicar; de fábrica, el presupuesto es $0 y no publica. Más detalles en [docs/agent/README.md](docs/agent/README.md).
- **Negocio.** Datos del negocio y **Conexiones** con cada canal.
- **Diagnóstico.**
  - Diagnóstico guiado con un plan de acción.
  - Estudio del negocio con IA: perfil, cliente ideal, palabras clave e ideas de campaña.
  - SEO:
    - Posiciones en Google y en Maps, con mapa de calor.
    - Palabras clave con búsquedas reales (DataForSEO).
    - Auditoría de la página web (con Google PageSpeed).
    - Search Console y Google Analytics 4.
    - Competencia y sus visitas.
    - Enlaces.
    - Perfil de Google y sus reseñas.
    - Si ChatGPT, Gemini y Claude recomiendan al negocio.
  - Herramientas como las de Semrush: ver quién sale ahora en Google, ideas de palabras, tus temas, comparar páginas, posiciones en computadora, ¿se movió Google?, anuncios de la competencia, qué hizo tu competencia (revisión semanal), quién habla de ti, reseñas en otros sitios, visitas de Google y de las IAs a tu web, y correos para pedir enlaces.
- **Marca.**
  - Identidad, kit de marca y manual de marca (se sube para que la IA lo lea, o lo crea la IA).
  - Logos por tipo.
  - Plantillas por red y diseños maestros con IA.
  - **Tus fotos y videos:** la biblioteca de cada negocio, desde una carpeta de Google Drive o un enlace para que los técnicos suban fotos. Incluye edición de fotos con IA.
- **Campañas y publicación.**
  - Campañas en tres modos: manual, con aprobación o 100 % IA.
  - Posts, videos, e ideas y plan con IA.
  - Anuncios pagados: nada gasta sin la confirmación del dueño.
  - Directorios y reseñas, y artículos para la web.
  - Historial con el error exacto de cada canal y un botón para reintentar.
  - Contactos.
  - **Publicar:** un solo texto con vista previa por canal, y se puede programar.
- **Resultados.** Métricas de cada publicación, reporte diario y por fechas, propuestas de la IA, registro de lo que hizo la IA, enlaces dañinos, y reporte SEO mensual con avisos por email.
- **Equipo y seguridad.**
  - Cada persona entra con su correo, con contraseña propia o con Google, y solo ve las empresas de su cuenta.
  - Papeles: **Administrador**, **Puede conectar**, **Puede publicar** y **Solo ver**. Los Administradores invitan a las personas y eligen a qué empresas entran.
  - **Cuenta → Organizaciones → Negocios.** La **cuenta** es la agencia o el dueño que entra a la app. Dentro de ella, cada cliente es una **organización** (por ejemplo «Ricardo PA (cliente)») y cada organización junta los **negocios** de ese cliente. Todo negocio pertenece a una organización de su cuenta. Los clientes no entran a la app. Si una cuenta todavía no tiene ninguna, el primer negocio crea «Mis compañías».
  - Solo el **Administrador** de la cuenta crea, renombra y borra organizaciones y pasa un negocio de una a otra, desde **Organizaciones** en el menú (`/organizaciones`; si administra varias cuentas, una pestaña por cuenta). Una organización solo se borra cuando no tiene negocios. Al crear un negocio se elige su organización. El selector de negocios los muestra en orden: la cuenta arriba, sus organizaciones debajo y los negocios de cada una (cerrado, en computadora dice cuenta / organización / negocio). Cada persona ve solo las organizaciones que tienen un negocio al que puede entrar.
  - **Reporte semanal por cliente.** Cada organización puede mandarle a su cliente un email cada semana con el resumen de la semana anterior completa (de lunes a domingo), a hasta 3 direcciones, en español o en inglés. Por cada negocio de la organización lleva solo lo que al cliente le toca ver: publicaciones, resultados, reseñas, visitas a la web, posiciones en Google y lo que viene. **Nunca** lleva costos, tareas, propuestas, alertas, lo que hizo la IA, campañas ni anuncios, nada del equipo de MATYA, notas de revisión ni enlaces a la app (el cliente no entra a ella), y armarlo no hace ninguna llamada de pago a la IA. Sale con el nombre de la cuenta como remitente, firmado «Enviado por» y ese nombre, y por la configuración de email del primer negocio de la organización.
  - Solo el **Administrador** de la cuenta lo configura, en la tarjeta de la organización (botón **Reporte semanal** en `/organizaciones`): contacto, teléfono, emails, idioma, zona horaria (si se deja vacía, la de la app), día, hora y el interruptor para encenderlo. La tarjeta muestra sin abrir nada cuándo sale y cómo le fue al último envío (un fallo se ve ahí mismo). **Mandarme una prueba** manda el reporte de la semana pasada al email del propio Administrador, con «Prueba · » en el asunto; **Mandar ahora** lo manda ya a los emails del cliente. Ninguno de los dos cuenta como el envío automático de la semana.
  - El envío automático lo revisan la vuelta de cada minuto del trabajador de la PC y el cron diario de Vercel (`/api/cron`): manda el reporte de la semana que ya tocó en la zona de la organización, y aunque los dos corran a la vez sale **un solo email por organización y semana**. Con solo el cron diario sale en la primera pasada después de la hora elegida. Si el proveedor de email falla, reintenta hasta 3 veces en total, con 30 minutos entre una y otra, y después espera a la semana siguiente; un error de configuración (falta el remitente o la clave del email) no se reintenta.
  - Límite de 5 intentos de entrada cada 15 minutos.
  - Los tokens de las cuentas se guardan cifrados (AES-256-GCM).
  - Desconectar un servicio de Google borra sus datos.
  - YouTube solo sube un video que una persona aprobó.
  - Ver [docs/privacy-readiness.md](docs/privacy-readiness.md).

## Canales para publicar

| Canal | Cómo se conecta | Ojo |
|---|---|---|
| Facebook | Botón **Conectar con Facebook** (`META_APP_ID`, `META_APP_SECRET`), o el ID y el token de la página a mano | |
| Instagram | Se conecta junto con Facebook | Tiene que ser una cuenta profesional vinculada a la página. Necesita foto o video. |
| Perfil de Google | Botón **Conectar con Google** (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) | El perfil tiene que estar verificado. |
| YouTube | Botón **Conectar con Google** | Cada video necesita la aprobación de una persona (título, privacidad y si es para niños). Unas 100 subidas al día. |
| TikTok | Client key, client secret y refresh token de una app con `video.publish` | Los videos salen en privado hasta que TikTok audite la app. |
| LinkedIn | Token del generador de tokens de LinkedIn | El token dura 60 días. Para publicar como página de empresa, LinkedIn tiene que aprobar la app. |
| X | Las 4 claves de la app (permiso «Read and write») | X cobra unos US$0.015 por post, o US$0.20 si lleva enlace. |
| Sitio web | Repositorio de GitHub del sitio y un token *fine-grained* | El sitio tiene que leer `content/articles.json`. La IA escribe el artículo en español e inglés. |
| Email | Con la clave de Brevo de la app (`BREVO_API_KEY`) cada negocio solo elige su remitente; también acepta una clave propia de Brevo o Resend | Solo va a contactos que aceptaron recibirlo. |
| Texto (SMS) | Twilio: Account SID, auth token y número que envía | Solo a contactos que aceptaron. En EE. UU. requiere el registro A2P 10DLC. |

Además, en **Conexiones** se conectan tres servicios que no publican, pero dan datos:

- **Search Console** y **Google Analytics 4**, cada uno con su botón; los dos usan el mismo inicio de sesión con Google.
- **Google Drive**, para la biblioteca de fotos. Usa una cuenta de servicio (`GOOGLE_SERVICE_ACCOUNT_JSON`), y el dueño comparte su carpeta con ese correo como «Lector».

**Guardar y probar** verifica cada cuenta sin publicar nada.

> Instagram, TikTok, YouTube y Google descargan las fotos y videos desde la app. Por eso la app tiene que estar publicada en internet; desde tu computadora no funciona.

## Ponerla en internet (Vercel + Supabase)

1. **Supabase.** Crea un proyecto para la app, separado del CRM y del sitio.
   - En *Project Settings → Database* copia las cadenas de conexión: el *Transaction pooler* (puerto 6543, agrega `?pgbouncer=true`) va en `DATABASE_URL`, y el *Session pooler* (puerto 5432) en `DIRECT_URL`.
   - En *Project Settings → API* copia la URL y la *service role key* para `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
   - La app crea sola el bucket público `media` para las fotos y videos.
2. **Vercel.** Importa este repositorio y pon las variables (ver [Variables](#variables)). `PUBLIC_BASE_URL` es la dirección de la app, por ejemplo `https://app.matya.app`.
3. **Crear las tablas** (una sola vez, en una base vacía):
   - Desde tu computadora, con `DATABASE_URL` y `DIRECT_URL` de Supabase en `.env`, corre `npm run db:push`. Crea todas las tablas.
   - Después aplica también `supabase/migrations/20261017180000_client_orgs.sql` en el SQL Editor: en una base nueva solo agrega el índice único parcial de `ClientOrgReport` que Prisma no expresa (es segura de correr ahí).
   - Después pega esto en el *SQL Editor* de Supabase. Activa RLS y le quita los permisos a `anon` y `authenticated`: la app entra con su propia conexión, y así la API pública de Supabase no puede leer los contactos ni las credenciales.

   ```sql
   DO $$
   DECLARE t record;
   BEGIN
     FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
       EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
       EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t.tablename);
     END LOOP;
   END $$;
   ```

   `supabase/schema.sql` es la primera versión de las tablas y ya no alcanza para una base nueva. `supabase/migrations/` guarda los cambios que se le aplicaron a la base que ya existía.

   En la base que ya existe (producción), aplica `supabase/migrations/20261017180000_client_orgs.sql` (SQL Editor de Supabase) **antes** de fusionar y desplegar este código: crea las organizaciones de cliente, le da a cada cuenta que ya tenía negocios una organización «Mis compañías» con todos sus negocios y deja `Business.clientOrgId` como obligatorio. Es aditiva y se puede volver a correr; sin ella la app no puede leer los negocios (el código nuevo lee `Business.clientOrg`, así que todas las páginas fallan). Entre aplicarla y el despliegue no uses «Agregar negocio»: el código viejo falla con una página de error, aunque no se daña nada.
4. **Primer acceso.** Entra con un correo de `LOGIN_EMAILS` y `APP_PASSWORD` (o con Google). El primer dueño que entra crea la cuenta principal y queda como Administrador. Desde **Equipo** invita a las demás personas.
5. **Google Cloud** (para «Conectar con Google» y «Entrar con Google»):
   - Crea un ID de cliente OAuth de tipo *Aplicación web*, con estas direcciones de regreso: `<PUBLIC_BASE_URL>/api/google/callback` y `<PUBLIC_BASE_URL>/api/auth/google/callback`.
   - Activa en ese proyecto estas APIs: las de Business Profile (My Business Account Management, Business Information y My Business), Search Console, Google Analytics Admin y Data, y YouTube Data API v3.
   - La app de OAuth tiene que estar **En producción**: en pruebas, los permisos vencen cada 7 días.
6. **Meta.** En developers.facebook.com, pon `<PUBLIC_BASE_URL>/api/meta/callback` como *Valid OAuth Redirect URI*.
7. **Publicaciones programadas.**
   - `vercel.json` llama a `/api/cron` una vez al día (13:00 UTC), que es lo máximo que permite el plan Hobby de Vercel.
   - Para que lo programado salga a su hora exacta, crea una tarea gratis en [cron-job.org](https://cron-job.org) que llame cada minuto a `<PUBLIC_BASE_URL>/api/cron` con el encabezado `Authorization: Bearer <CRON_SECRET>`.
   - Con Vercel Pro puedes cambiar el horario de `vercel.json` a `* * * * *`.
   - El agente MATYA usa su propio llamado, `/api/cron?agent=1` (ver [docs/agent/README.md](docs/agent/README.md)).
8. **Tu sitio web** (canal «Sitio web»):
   - El sitio tiene que leer `content/articles.json` (ver el cambio en RicardoPA-Web).
   - En **Conexiones** pones el repositorio, la rama que publica Vercel (casi siempre `main`), la dirección del sitio y un token *fine-grained* solo para ese repositorio.
   - Permisos del token: **Contents: Read and write**, **Pull requests: Read and write**, **Commit statuses: Read**, **Checks: Read** y **Metadata: Read**. Los de pull requests, estados y checks sirven para «Arréglalo por mí»: Matya prepara el arreglo de tu web y tú apruebas cada cambio.

## Variables

Todas van en Vercel (o en `.env` para correrla en tu computadora). `.env.example` explica cada una.

| Para qué | Variables |
|---|---|
| **Obligatorias** | `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_PASSWORD`, `APP_SECRET`, `LOGIN_EMAILS`, `PUBLIC_BASE_URL`, `CRON_SECRET` |
| IA de textos | `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| Fotos, diseños y videos con IA | `FAL_KEY`, `IDEOGRAM_API_KEY`, `DESIGN_AI_MODELS`, `DESIGN_AI_MAX_USD`, `VIDEO_PROVIDER`, `VIDEO_MAX_USD`, `VIDEO_DAILY_MAX` |
| Facebook, Instagram y anuncios | `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `META_ADS_CONFIG_ID` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON` (Drive) |
| Email de la app | `BREVO_API_KEY`, `AUTH_EMAIL_FROM` (invitaciones y contraseñas), `ALERTS_FROM` (avisos de SEO) |
| SEO | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` (pago por uso), `PAGESPEED_API_KEY` |
| Biblioteca de fotos (Cloudflare R2) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` |
| Agente MATYA | `MATYA_AGENT_ENABLED`, `MATYA_AGENT_PROVIDER`, `MATYA_AGENT_MODEL`, `MATYA_AGENT_INPUT_USD_PER_MILLION`, `MATYA_AGENT_OUTPUT_USD_PER_MILLION`, `MATYA_WORKER_URL` |
| Otras | `BUSINESS_TZ` (zona horaria; por defecto `America/New_York`), `GOOGLE_REVOKED_PURGE=off` (pausa el borrado de datos de Google sin permiso), `SCHEDULER=off` (apaga el publicador fuera de Vercel) |

> **Nunca cambies `APP_SECRET`:** cifra las conexiones y, si cambia, hay que volver a conectar todo. Para sacar a todos, cambia `APP_PASSWORD`.

## Correrla en tu computadora

Necesitas [Node.js 20 o más nuevo](https://nodejs.org) y una base de datos Postgres.

```bash
npm install
cp .env.example .env      # luego edita .env
npm run db:push           # crea las tablas
npm run dev               # abre http://localhost:3000
```

- Sin `SUPABASE_URL`, las fotos y videos se guardan en la carpeta `uploads/` de tu computadora, y las redes no pueden descargarlos desde ahí.
- Fuera de Vercel, la app revisa cada minuto si hay publicaciones programadas (`src/scheduler.ts`).

## Comandos

- `npm test`: pruebas automáticas. Las pruebas con base de datos real del agente solo corren con un PostgreSQL local; ver [docs/agent/testing.md](docs/agent/testing.md).
- `npm run lint`: revisión del código.
- `npm run typecheck`: revisión de tipos.
- `npm run build`: compila como en Vercel.
