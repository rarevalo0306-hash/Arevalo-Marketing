# Organizaciones por cliente — diseño

Fecha: 2026-10-17. Aprobado en conversación, parte por parte, antes de escribir este documento.

## Para qué

El dueño de Matya trabaja como agencia: toma clientes para hacerles publicidad. Cada cliente (por ejemplo, Juan Pérez con sus 3 compañías) debe quedar agrupado en una **organización**, y las compañías propias del dueño en otra. Cada compañía sigue teniendo todo lo suyo (equipo MATYA, presupuesto, conexiones, reportes). El cliente **no entra al app**: recibe **un reporte semanal por email** con el resumen de todas sus compañías. La organización debe verse con claridad, también en el celular.

Es la parte 1 de un plan más grande, en este orden: 1) organizaciones por cliente (este documento); 2) perfil del usuario y de la cuenta; 3) billing (tarjeta, cobro y gasto de IA por cuenta); 4) registro abierto para vender el app (cada cliente del app crea su propia cuenta). Las partes 2 a 4 tendrán su propio diseño.

## Los nombres

| En la pantalla | En el código | Qué es |
|---|---|---|
| **Cuenta** | `Organization` (ya existe) | El cliente del app: su personal con papeles, sus invitaciones, sus compañías. Hoy la pantalla la llama «organización». |
| **Organización** | `ClientOrg` (nuevo) | Un cliente de la cuenta, con sus compañías y los datos para su reporte semanal. |
| **Compañía** | `Business` (ya existe) | Igual que hoy, con todo lo suyo. |

`Organization` no se renombra en el código ni en la base: solo cambia lo que dice la pantalla («Cuenta»). Así nada de lo que ya existe (sesiones, papeles, invitaciones, acceso por compañía, el centro MATYA) cambia de forma.

## Decisiones

- **Los clientes no entran.** No hay papeles nuevos ni inicio de sesión para clientes. Las organizaciones las crea y maneja el personal de la cuenta.
- **Quién maneja organizaciones:** solo un **Administrador de la cuenta** (`requireOrgAdmin` de la cuenta dueña) las crea, edita, borra y mueve compañías entre ellas. El resto del personal ve las compañías a las que tiene acceso, como hoy; el acceso del personal sigue siendo por compañía (`Membership.allBusinesses` / `MembershipBusiness`), no por organización.
- **Cada compañía pertenece a una sola organización**, y esa organización es siempre de la misma cuenta que la compañía. La base lo garantiza (ver «Datos»).
- **Lo que ya existe:** la migración crea en cada cuenta una organización «Mis compañías» y pone ahí todas sus compañías. Ninguna queda sin organización.
- **Borrar una organización** solo se puede si no tiene compañías.
- **Mover una compañía** solo cambia su organización. Sus publicaciones, equipo MATYA, conexiones, reportes e historial no cambian.
- **El reporte semanal es por organización**: un solo email por semana al cliente, con todas sus compañías. Los reportes de cada compañía (el diario y los de SEO) siguen como están.
- **Sin llamadas de pago** en el reporte semanal: el resumen se arma con reglas a partir de los datos.

## Datos

Tabla nueva `ClientOrg`:

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String` (cuid) | |
| `organizationId` | `String` | La cuenta. FK a `Organization`, `onDelete: Cascade`. |
| `name` | `String` | 1 a 120 caracteres, sin espacios a los lados. |
| `contactName` | `String` (default `""`) | Hasta 120. |
| `reportEmail` | `String` (default `""`) | Hasta 3 emails separados por comas; se validan con `looksLikeEmail`. |
| `phone` | `String` (default `""`) | Hasta 40. |
| `reportLang` | `String` (default `"es"`) | `es` o `en`. |
| `reportOn` | `Boolean` (default `false`) | Reporte semanal encendido. |
| `reportDay` | `Int` (default `1`) | Día de envío, 0 = domingo … 6 = sábado; por defecto lunes. |
| `reportHour` | `Int` (default `8`) | Hora de envío, 0 a 23, en `timezone`. |
| `timezone` | `String` (default `""`) | IANA; `""` = la de la app (`BUSINESS_TZ`). Define la semana y la hora de envío. |
| `createdAt` | `DateTime` | |

- `@@unique([id, organizationId])` y `@@index([organizationId])`.
- `Business` gana `clientOrgId String` (obligatorio tras la migración) con una FK **compuesta** `(clientOrgId, organizationId) → ClientOrg(id, organizationId)`, `onDelete: Restrict`: la base no deja que una compañía apunte a la organización de otra cuenta, ni borrar una organización con compañías. `@@index([clientOrgId])`.

Tabla nueva `ClientOrgReport`, el registro de cada envío semanal:

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String` (cuid) | |
| `clientOrgId` | `String` | FK a `ClientOrg`, `onDelete: Cascade`. |
| `week` | `String` | El lunes de la semana reportada, `YYYY-MM-DD`, en la zona de la organización. |
| `trigger` | `String` | `cron`, `manual` o `test`. |
| `state` | `String` | `sending`, `sent`, `error` o `skipped`. |
| `to` | `String[]` | A quién se mandó (para `test`, el email de quien lo pidió). |
| `attempts` | `Int` (default 1) | |
| `error` | `String` (default `""`) | Hasta 300 caracteres; nunca secretos. |
| `createdAt` / `updatedAt` | `DateTime` | |

- `@@index([clientOrgId, createdAt])` en Prisma, y en SQL un **índice único parcial** `UNIQUE (clientOrgId, week) WHERE trigger = 'cron'` (Prisma no lo expresa; vive solo en la migración): la semana automática sale una sola vez y `manual`/`test` se pueden repetir.

Migración `supabase/migrations/20261017180000_client_orgs.sql`, aditiva y en una transacción:
1. Crea `ClientOrg` y `ClientOrgReport` con sus índices (RLS encendido y sin permisos para `anon`/`authenticated`, como las demás tablas).
2. Agrega `Business.clientOrgId` como nulo.
3. Por cada `Organization`, crea una `ClientOrg` «Mis compañías» y le asigna todas sus compañías.
4. Pone `clientOrgId` como obligatorio y agrega la FK compuesta y los índices.
5. Es idempotente donde se puede (`IF NOT EXISTS`); el paso 3 solo toca compañías con `clientOrgId` nulo.

Se aplica en Supabase **antes** de fusionar la entrega 1.

## Entrega 1: organizaciones en la pantalla

**Página «Organizaciones»** (`/organizaciones`), en el menú junto a «Equipo y permisos», solo para Administradores de la cuenta (si administra varias cuentas, `?cuenta=<id>` elige cuál, como `/equipo?org=`):
- Lista de organizaciones de la cuenta, cada una con sus compañías (punto de color y nombre, con enlace a su Inicio).
- **Nueva organización** (nombre).
- **Editar** el nombre.
- **Mover** una compañía a otra organización de la misma cuenta (un selector por compañía).
- **Borrar** una organización vacía (el botón solo aparece sin compañías; si la base la rechaza igual, se dice por qué).

**Agregar compañía** (`/negocios/nuevo`): un selector «Organización» con las organizaciones de la cuenta; por defecto «Mis compañías» o la que llegue por `?organizacion=<id>` (el enlace «Agregar compañía» de cada organización lo pasa). Si la cuenta no tiene ninguna, se crea «Mis compañías» en ese momento. `createBusinessFromWeb` valida que la organización elegida sea de la cuenta donde se crea la compañía.

**Selector de compañías** (`BizSwitcher` en computadora, `MobileBizMenu` en el celular): agrupado por organización, con el nombre de cada organización como encabezado; organizaciones y compañías en orden de creación; una organización sin compañías visibles para esa persona no aparece. El botón del selector muestra la organización en letra pequeña encima del nombre de la compañía activa. Si todas las compañías visibles están en una sola organización, el encabezado se muestra igual (así se ve a qué cliente pertenece).

**«Cuenta» en lugar de «organización»:** el pie del menú dice «Cuenta: <nombre>»; en «Equipo y permisos» los textos que hoy dicen «organización» pasan a «cuenta»; la lista de compañías al elegir el acceso de una persona se agrupa por organización.

**Acciones nuevas** (`src/app/actions-client-orgs.ts`), todas con `ensure` en sus argumentos y `requireOrgAdmin(cuenta)`, y toda escritura filtrada por `organizationId` de la cuenta:
- `createClientOrg(cuentaId, form)`, `renameClientOrg(cuentaId, clientOrgId, form)`, `deleteClientOrg(cuentaId, clientOrgId)`, `moveBusiness(cuentaId, businessId, clientOrgId)`.
- `moveBusiness` usa un `updateMany` con `where: { id: businessId, organizationId: cuentaId }` y comprueba antes que `clientOrgId` sea de `cuentaId`; la FK compuesta es la segunda barrera.
- Lo pesado y puro (validar nombres y emails, agrupar compañías por organización) vive en `src/lib/client-orgs.ts`, sin base, para probarlo.

## Entrega 2: reporte semanal por organización

**Datos del cliente en la organización** (en «Organizaciones», al editar): nombre del contacto, emails para el reporte (hasta 3), teléfono, idioma del reporte, zona horaria, y el reporte semanal: encendido, día y hora (por defecto lunes, 8:00 a. m.).

**La semana:** la última semana completa antes del momento del envío, del lunes 00:00 al lunes siguiente 00:00 (sin incluirlo), en la zona de la organización. Con el envío por defecto (lunes 8:00 a. m.) son los 7 días que acaban de terminar; con otro día, sigue siendo la última semana lunes a domingo ya cerrada. `week` es el lunes en que empieza. Se reutiliza `RangePeriod` y `buildReportFor` de cada compañía para ese rango.

**Qué lleva el email**, en el idioma de la organización:
- Encabezado: nombre de la organización y la semana.
- **Resumen**: hasta 3 puntos armados con reglas (`reportHighlights` con `ai: false`) a partir de los reportes de sus compañías, alternando compañías.
- **Por cada compañía**, solo las secciones para el cliente del `PeriodReport`: `posts` (lo publicado, por canal, con enlace), `results` (alcance, me gusta, comentarios), `reviews`, `web`, `rankings` (lo que subió y lo que bajó) y `next` (lo que viene). Una compañía sin nada en la semana dice «Sin actividad esta semana».
- **Nunca**: `costs`, `tasks`, `proposals`, `alerts`, `ai`, `campaigns` ni `ads` (gasto), ni nada del equipo MATYA ni notas de revisión. La lista de secciones permitidas es explícita (una lista blanca), así que una sección nueva del reporte no aparece sola.
- Pie: «Enviado por <nombre de la cuenta>». Sin enlaces al app (el cliente no entra).

**Remitente:** el mismo de siempre (`resolveSender`) de la primera compañía de la organización, con el nombre de la cuenta como nombre visible. Sin remitente posible, se anota el error de configuración y no se reintenta cada minuto (`SenderConfigError`).

**Cuándo sale:** `runClientOrgReports(now, { max, budgetMs })` busca organizaciones con `reportOn`, con emails, con compañías, ya pasado su día y hora en su zona, y sin un envío `cron` de esa semana. Lo llaman el llamado de cada minuto (en el ciclo global, después de los reportes diarios del equipo, en su propio try/catch) y el cron diario de la plataforma (`/api/cron`), por si la PC estuvo apagada. Para no mandar dos veces: el índice único parcial de `ClientOrgReport` (se reclama la semana insertando la fila `sending`; si ya existe, no se manda).

**Errores:** si falla un envío `cron`, la misma fila queda `error` con el motivo. Se reintenta reclamándola de nuevo (`updateMany` de `error` a `sending` con `attempts < 3` y `updatedAt` de hace 30 minutos o más, que suma 1 a `attempts`); tras el tercer intento fallido se detiene hasta la semana siguiente. Una fila que quedó `sending` más de 30 minutos (el envío se cortó) se trata como `error`. Un error de configuración (`SenderConfigError`) no se reintenta. Sin emails o sin compañías: no se manda y la página lo dice junto al interruptor.

**Botones** en cada organización: **«Mandarme una prueba»** (a quien lo pide, `trigger: test`, marcado «Prueba» en el asunto) y **«Mandar ahora»** (a los emails del cliente, `trigger: manual`, con la semana anterior). Los dos esperan confirmación y no cuentan como el envío automático de la semana. La página muestra el último envío (fecha, a quién y si salió o el error).

## Fuera de alcance

Billing, perfil, registro abierto, inicio de sesión de clientes, acceso del personal por organización, mover compañías entre cuentas, unir o dividir organizaciones, y cualquier cambio al equipo MATYA o a los reportes de cada compañía.

## Pruebas

- **Puras** (`src/lib/client-orgs.ts` y el armado del email): validación de nombre y emails; agrupación y orden del selector (incluida una persona con acceso a pocas compañías); la semana lunes a lunes en zonas con cambio de horario; cuándo toca enviar según día, hora y zona; la lista blanca de secciones (un reporte con todas las secciones llenas no muestra ninguna interna); el resumen sin IA; el email en español e inglés, con todo escapado.
- **Acciones**: un no Administrador no crea, edita, borra ni mueve; no se puede mover una compañía a una organización de otra cuenta ni tocar una organización de otra cuenta; borrar una organización con compañías falla con un mensaje claro.
- **Con base de datos real** (proyecto `database` de vitest): la migración sobre datos con varias cuentas deja cada compañía en «Mis compañías» de su cuenta; la FK compuesta rechaza una compañía con la organización de otra cuenta; el índice parcial impide dos envíos `cron` de la misma semana aunque se pidan a la vez; `manual` y `test` se pueden repetir.
- **En el navegador** (`scripts/agent-ui-check.mjs` o un script hermano, con el seed local que gana dos organizaciones): la página «Organizaciones» y el selector agrupado a 390 y 1280 px, sin scroll lateral, en tema claro y nocturno.

## Entrega

Dos PRs, cada uno con su revisión y la aprobación del dueño para fusionar:
1. **Organizaciones**: migración, tablas, página, mover, agregar compañía con organización, selector agrupado, «Cuenta».
2. **Reporte semanal por organización**: datos del cliente, envío, prueba y «Mandar ahora».

La migración (con las dos tablas) va en la entrega 1, así que la entrega 2 no necesita otra.
