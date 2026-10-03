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
| SEO / Blog | WordPress REST API | Dirección del sitio, usuario y una contraseña de aplicación |
| Email | Resend | API key y remitente con dominio verificado |
| Texto (SMS) | Twilio | Account SID, auth token y número que envía (en EE. UU. requiere registro A2P 10DLC) |

En la pantalla **Conexiones** pegas esos datos y presionas **Guardar y probar**: la app verifica la cuenta sin publicar nada.

> Instagram, TikTok y Google descargan tus fotos y videos desde la app, así que para esos canales la app tiene que estar publicada en internet (no solo en tu computadora), o puedes pegar un enlace público al archivo.

## Correrla en tu computadora

Necesitas [Node.js 20 o más nuevo](https://nodejs.org).

```bash
npm install
cp .env.example .env      # luego edita .env: contraseña y claves
npm run db:push           # crea la base de datos
npm run build
npm start                 # abre http://localhost:3000
```

Para desarrollar: `npm run dev`.

## Publicarla en internet

Funciona en cualquier servidor con Node y disco (Railway, Render, Fly.io, un VPS):

1. Configura las variables de `.env.example` en el servidor. `PUBLIC_BASE_URL` debe ser la dirección pública (https://…).
2. Comando de inicio: `npm run db:push && npm start`.
3. Las publicaciones programadas salen solas cada minuto mientras el servidor esté encendido. Si tu servidor se apaga cuando no hay visitas, llama cada minuto a `GET /api/cron` con el encabezado `Authorization: Bearer <CRON_SECRET>`.

Para una base de datos en la nube (Postgres), cambia `provider = "sqlite"` por `"postgresql"` en `prisma/schema.prisma` y pon la dirección en `DATABASE_URL`.

## Comandos

- `npm test` — pruebas automáticas
- `npm run lint` — revisión del código
- `npm run typecheck` — revisión de tipos
