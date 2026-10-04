# Arevalo Marketing

Escribe una publicación una vez y sale en Facebook, Instagram, TikTok, Google, tu blog (SEO), email y mensajes de texto, para cada uno de tus negocios.

## Qué hace

- **Varios negocios.** Cada negocio tiene su color, sus cuentas conectadas, sus contactos y su historial.
- **Publicar en todos lados.** Un solo texto, con foto o video opcional. Ves cómo queda en cada canal antes de publicar y la app avisa si falta algo (TikTok necesita video, el email necesita asunto, etc.).
- **Programar.** Elige fecha y hora; la app lo publica sola.
- **Historial.** Qué salió en cada canal, enlaces a cada publicación, y el error exacto si algo falló, con un botón para reintentar.
- **Contactos.** Agrega o pega tu lista desde Excel. Email y SMS solo van a quien aceptó recibirlos.
- **Seguro.** Entra con contraseña. Los tokens de tus cuentas se guardan cifrados (AES-256-GCM).

## Canales y qué usa cada uno

| Canal | Servicio | Qué necesitas |
|---|---|---|
| Facebook | Meta Graph API | ID de la página y token de página con `pages_manage_posts` |
| Instagram | Meta Graph API | Cuenta profesional vinculada a la página y token con `instagram_content_publish` |
| TikTok | Content Posting API | App en developers.tiktok.com con `video.publish` (client key, client secret, refresh token). Mientras TikTok no audite tu app, los videos salen en privado. |
| Google | Business Profile API | Perfil de Negocio verificado y credenciales OAuth (client ID, secret, refresh token) |
| Sitio web / SEO | GitHub + Vercel + Claude | Tu sitio en GitHub preparado para recibir artículos (`content/articles.json`) y un token de GitHub con permiso de escritura en ese repositorio. Claude redacta el artículo en español e inglés a partir de tu publicación, sin agregar datos que no escribiste. |
| Email | Resend | API key y remitente con dominio verificado |
| Texto (SMS) | Twilio | Account SID, auth token y número que envía (en EE. UU. requiere registro A2P 10DLC) |

En la pantalla **Conexiones** pegas esos datos y presionas **Guardar y probar**: la app verifica la cuenta sin publicar nada.

> Instagram, TikTok y Google descargan tus fotos y videos desde la app, así que para esos canales la app tiene que estar publicada en internet (no solo en tu computadora), o puedes pegar un enlace público al archivo.

## Ponerla en internet (Vercel + Supabase)

1. **Supabase**: crea un proyecto para la app (separado del CRM y del sitio). En *Project Settings → Database* copia las cadenas de conexión: el *Transaction pooler* (puerto 6543, agrega `?pgbouncer=true`) va en `DATABASE_URL` y el *Session pooler* (puerto 5432) en `DIRECT_URL`. En *Project Settings → API* copia la URL y la *service role key* para `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. La app crea sola el bucket público `media` para las fotos y videos.
2. **Vercel**: importa este repositorio como proyecto nuevo y pon todas las variables de `.env.example`. `PUBLIC_BASE_URL` es la dirección que te da Vercel (o tu dominio, por ejemplo `https://marketing.ricardopa.com`).
3. **Crear las tablas**: una sola vez, pega `supabase/schema.sql` en el *SQL Editor* de Supabase (o corre `npm run db:push` desde tu computadora y luego la parte de seguridad al final de ese archivo). Ese archivo activa RLS y quita permisos a `anon` y `authenticated`: la app entra con su propia conexión y la API pública de Supabase no puede leer los contactos ni las credenciales.
4. **Publicaciones programadas**: `vercel.json` le pide a Vercel Cron que llame a `/api/cron` cada minuto, con tu `CRON_SECRET`. En el plan Hobby de Vercel los crons corren solo una vez al día; para publicar a la hora exacta necesitas el plan Pro.
5. **Tu sitio**: para el canal "Sitio web", tu sitio necesita leer `content/articles.json` (ver el cambio en RicardoPA-Web). En *Conexiones* pones el repositorio, la rama (`main`), la dirección del sitio y un token de GitHub *fine-grained* con permiso **Contents: Read and write** solo en ese repositorio.

## Correrla en tu computadora

Necesitas [Node.js 20 o más nuevo](https://nodejs.org) y una base de datos Postgres (la de Supabase sirve).

```bash
npm install
cp .env.example .env      # luego edita .env
npm run db:push           # crea las tablas
npm run dev               # abre http://localhost:3000
```

Sin `SUPABASE_URL`, las fotos y videos se guardan en la carpeta `uploads/` de tu computadora (las redes no pueden descargarlos desde ahí).

## Comandos

- `npm test` — pruebas automáticas
- `npm run lint` — revisión del código
- `npm run typecheck` — revisión de tipos
