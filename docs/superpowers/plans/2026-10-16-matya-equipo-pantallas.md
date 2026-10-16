# MATYA equipo: pantallas y avisos (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el dueño vea y maneje el equipo de agentes desde el Centro MATYA (Hoy, Necesita tu sí, Equipo, detalle de la pieza, configuración del modo equipo y «Pausar todo»), y que reciba la sección MATYA del reporte diario y las alertas por email.

**Architecture:**
- **El motor ya está en main (PR #69).** Este PR le agrega solo tres cosas pequeñas:
  - registrar cuándo llegó la última vuelta del llamado de cada minuto;
  - mensajes de presupuesto distintos para el límite por encargo y el límite diario;
  - una nota del dueño en «Rehacer».
- **Un módulo puro arma la vista** (`team-view.ts`). Recibe los encargos y pasos del equipo y decide la columna, el estado y lo que espera aprobación. Se puede usar desde el navegador y desde el servidor.
- **El servidor carga los datos** (`teamSnapshot`) y los agrega al `snapshot` que ya consume `AgentCenter`.
- **Las alertas y el reporte diario corren en la vuelta de cada minuto del agente.** Usan el mismo remitente (`sendSeoEmail`) y un registro anti-duplicado en `SeoReport`, igual que el reporte diario.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript estricto, Prisma 6 + PostgreSQL (Supabase), zod 4, vitest (`environment: "node"`, pruebas de UI con `renderToStaticMarkup`), CSS Modules.

**Spec:** `docs/superpowers/specs/2026-10-16-matya-equipo-de-agentes-design.md`. Este PR cubre las secciones 8.1, 8.2 y 8.3, y el aviso de la 6.1 cuando el llamado de cada minuto no está activo.

## Global Constraints

- Con `teamMode` apagado todo queda como hoy: no aparecen pestañas nuevas, no salen alertas, el reporte diario no tiene sección MATYA ni cambia de horario, y la configuración solo agrega la sección «Modo equipo».
- Solo un Administrador ve y cambia el Centro MATYA (`requireAgentOwner`, como hoy).
- **Textos:**
  - Todo texto visible es bilingüe con `useT()` → `t(es, en)`, en español primero.
  - Las fechas y horas se muestran en la zona del negocio (`businessTz`).
  - El dinero se muestra con `usd(cents)`, que es la misma función que usa `AgentCenter`.
- **Dependencias y migración:**
  - No hay dependencias nuevas.
  - La única migración nueva es `supabase/migrations/20261017120000_matya_tick.sql`. Es aditiva e idempotente (`IF NOT EXISTS`), mantiene RLS y deja sin permisos a `anon` y `authenticated`, como `20261016120000_matya_team.sql`.
  - Se aplica en Supabase **antes** de fusionar.
- **Emails:** salen con `sendSeoEmail`, a `dailyRecipients(business)` y en el idioma `emailLang(business.seoEmailLang)`. Los enlaces usan `publicBase()`.
- **Alertas:** como máximo 5 emails de alerta por negocio y día local (`AgentBudget.alerts`). Las caídas en Google siguen en las alertas de SEO y no se repiten aquí.
- **Nota de «Rehacer»:** máximo 500 caracteres, sin espacios al principio ni al final. Es texto del dueño; se muestra siempre escapado, porque React ya escapa todo lo que muestra (nunca `dangerouslySetInnerHTML`).
- **Pruebas:**
  - Nunca hay publicaciones reales ni llamadas de pago.
  - Las pruebas de base de datos siguen el patrón de `tests/agent-database.test.ts`: se omiten fuera de `127.0.0.1:55439/matya_agent` y usan solo `matya-it-a`/`matya-it-b`.
  - Las de UI usan `renderToStaticMarkup` con el CSS Module simulado, como `tests/youtube-fields.test.tsx`.
- **Pantalla:** funciona en 390 px de ancho sin desplazamiento horizontal de la página. El tablero se apila en una columna en pantallas angostas.
- **Commits:**
  - Cada commit termina con estas dos líneas exactas:
    - `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
    - `Claude-Session: https://claude.ai/code/session_01N6TYBTCrH3PsdJnjsukzYp`
  - Antes de cada commit pasan `npx tsc --noEmit` y `npx eslint` sobre los archivos tocados, sin errores nuevos.

## Decisiones frente al spec

- **YouTube en «Necesita tu sí»:** no se muestra. El equipo nunca publica en YouTube, porque el validador lo descarta (`validatePieces`). Las aprobaciones de YouTube siguen en las pantallas de publicaciones del PR #64.
- **«Último tick» (6.1):**
  - Hace falta guardar el dato, así que se agrega la columna `AgentWorkspace.tickAt`.
  - Solo la vuelta global de `/api/cron?agent=1` la escribe, porque solo ella prueba que el llamado de cada minuto existe. La vuelta que lanza el botón del dueño no la escribe.
- **Registro anti-duplicado de alertas:** se guardan filas `SeoReport` con `kind: "agent_alert"`, igual que el reporte diario usa `kind: "daily"`. No hace falta una tabla nueva.
- **Envío de alertas fallido:** queda registrado y no se reintenta, porque la pantalla Hoy siempre muestra el estado real. Un envío fallido no gasta del tope diario.
- **«Se envía después del plan de la mañana» (8.1):** con `teamMode` encendido, el reporte del día espera a que el plan de hoy termine. Si no termina, sale 3 horas después de `dailyHour`.
  - Sale enseguida si el llamado de cada minuto no está activo, si MATYA está apagada o si está en pausa, porque en esos casos no va a llegar ningún plan.
  - La vuelta de cada minuto del agente también llama a `runDailyReports`, solo para los negocios con modo equipo. Así el reporte no se pierde cuando el cron de Vercel corre una sola vez al día.
- **«Trabajos recientes»:** la lista de la pestaña Conversación deja fuera las piezas hijas (`parentRunId` no nulo). Las piezas se ven en Hoy.

## Review Focus

1. **Plan ilegible:** una pieza con un plan ilegible (`plan` nulo, sin `steps` o con un paso que no conocemos) aparece en una columna segura (Redacción) con su estado, sin romper el tablero.
2. **Equipo sin trabajo hoy:**
  - Un negocio con modo equipo, sin encargos de equipo hoy y sin registro de presupuesto del día muestra estados vacíos claros.
  - `teamSnapshot` devuelve listas vacías.
3. **Medianoche y cambio de hora:** cerca de la medianoche del negocio o en un día con cambio de hora, «hoy» y la espera del reporte usan el reloj de pared del negocio (`localDay`, `clockMinutes`), nunca la hora UTC.
4. **Remitente mal configurado:** si el remitente falla (`SenderConfigError`), la alerta queda con estado `error`, no gasta del tope y no se reintenta en cada vuelta. Las demás empresas siguen y el reporte diario no se afecta.
5. **«Rehacer» repetido o nota inválida:**
  - Si el dueño pulsa «Rehacer» dos veces seguidas, la segunda vez el motor dice que la pieza ya no espera aprobación.
  - Una nota de 501 caracteres da 400.
  - Una nota con `<script>` se guarda tal cual y se muestra escapada.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/20261017120000_matya_tick.sql` | Columna `AgentWorkspace.tickAt`. |
| `prisma/schema.prisma` | `tickAt DateTime?` en `AgentWorkspace`. |
| `src/lib/agent/queue.ts` | Constantes de error del presupuesto, la nota del dueño en `redo` y `changeRun(…, opts)`. |
| `src/lib/agent/daily.ts` | Exporta `clockMinutes` y `dailyPlanKey`. |
| `src/lib/agent/agents/copy.ts` | La nota del dueño entra en las notas de la vuelta de redacción o de artículo. |
| `src/lib/agent/team-view.ts` (nuevo, puro) | Tipos de la vista del equipo; columna, estado y «Necesita tu sí». |
| `src/lib/agent/service.ts` | `teamSnapshot`, el sello `tickAt`, y las alertas y el reporte en la vuelta global. |
| `src/lib/agent/alerts.ts` (nuevo) | Hechos que avisan (puro), email (puro) y `sendAgentAlerts` (base de datos y envío). |
| `src/lib/agent/daily-section.ts` (nuevo) | Sección MATYA del reporte (datos, HTML y texto) y `matyaReportReady`. |
| `src/lib/daily-report.ts` | Agrega la sección MATYA y la espera del plan de la mañana. |
| `src/lib/agent/settings-input.ts` | `readRate`, para leer precios por millón con decimales. |
| `src/app/api/agent/[id]/route.ts` | `note` en `redo`. |
| `src/components/agent/shared.tsx` (nuevo) | `usd`, `safeHref`, `labels`, `stepNames` y `Output`, sacados de `AgentCenter.tsx`. |
| `src/components/agent/TeamToday.tsx` (nuevo) | Pestaña Hoy: avisos, plan, «Necesita tu sí», tablero y detalle de la pieza. |
| `src/components/agent/TeamRoster.tsx` (nuevo) | Pestaña Equipo. |
| `src/components/agent/TeamSettings.tsx` (nuevo) | Sección «Modo equipo» de la configuración y «Pausar todo». |
| `src/components/agent/Team.module.css` (nuevo) | Estilos de las tres pantallas. |
| `src/components/agent/AgentCenter.tsx`, `AgentSettings.tsx`, `types.ts` | Conexión de las pestañas y del `Snapshot`. |
| `scripts/agent-seed-local.mjs` | Datos sintéticos del equipo y un Administrador local para revisar en el navegador. |
| `docs/agent/README.md`, `docs/agent/testing.md` | Pantallas, avisos y la migración nueva. |

---

### Task 1: Último tick y mensajes de presupuesto

**Files:**
- Create: `supabase/migrations/20261017120000_matya_tick.sql`
- Modify: `prisma/schema.prisma` (model `AgentWorkspace`)
- Modify: `src/lib/agent/queue.ts` (`beginStep`, `finishStep`)
- Modify: `src/lib/agent/service.ts` (`runAgentCycle`)
- Modify: `src/lib/agent/daily.ts`
- Modify: `docs/agent/testing.md` (paso 4 y la nota de migraciones)
- Test: `tests/agent-database.test.ts`, `tests/agent-daily.test.ts`

**Interfaces:**
- Produces:
  - `tickAt` en las filas de `AgentWorkspace`.
  - Exportadas desde `queue.ts`: `RUN_BUDGET_ERROR = "El encargo alcanzó el límite de gasto. No se hizo una nueva llamada de pago."` (el texto de hoy), `DAY_BUDGET_ERROR = "Se acabó el presupuesto de IA de hoy. No se hizo una nueva llamada de pago."` y `OVER_RESERVATION_ERROR = "El consumo superó la reserva: revisa las tarifas antes de continuar."` (el texto de hoy).
  - Exportadas desde `daily.ts`: `clockMinutes(tz, now): number` y `dailyPlanKey(businessId, day): string`.

- [ ] **Step 1: Write the failing tests**
  - En `agent-database.test.ts`:
    - `"the global agent tick stamps tickAt on every workspace; an owner's cycle does not"`. Llama a `runAgentCycle()` y comprueba que `tickAt` de los dos negocios queda a menos de 5 s de ahora. Luego pone `tickAt = null` en A, llama a `runAgentCycle(A)` y comprueba que sigue `null`.
    - `"a step over the daily budget is refused with DAY_BUDGET_ERROR, over the run budget with RUN_BUDGET_ERROR"`. Arma dos casos con `dailyBudgetCents`/`runBudgetCents`. Cuando los dos topes se superan, gana el diario. Comprueba `run.error` igual a la constante.
    - Cambia a las constantes las pruebas que hoy comparan el texto viejo del límite diario. Búscalas con `grep -n "alcanzó el límite de gasto" tests/`.
  - En `agent-daily.test.ts`: `"clockMinutes reads the wall clock: 07:30 is 450 on a DST day"`, con `America/New_York` el 2026-11-01 y el 2026-03-08.

- [ ] **Step 2: Run them to verify they fail**

  Run: `npx vitest run tests/agent-daily.test.ts tests/agent-database.test.ts -t "tickAt|DAY_BUDGET|clockMinutes"`, con las variables de la base local.
  Expected: FAIL. `tickAt` no existe y `clockMinutes` no está exportada.

- [ ] **Step 3: Implement**
  - Migración, copiando el formato de `20261016120000_matya_team.sql`: `BEGIN; ALTER TABLE "AgentWorkspace" ADD COLUMN IF NOT EXISTS "tickAt" TIMESTAMP(3); COMMIT;`, con el mismo comentario de cabecera.
  - Prisma: `tickAt DateTime?` en `AgentWorkspace`.
  - `runAgentCycle(businessId?)`: si `businessId` es `undefined` (la vuelta global) y `MATYA_AGENT_ENABLED === "true"`, al empezar hace `db.agentWorkspace.updateMany({ data: { tickAt: new Date() } })`. No mueve `revision`.
  - En `beginStep`, la condición de dinero se separa: el tope diario lanza `DAY_BUDGET_ERROR` y el del encargo `RUN_BUDGET_ERROR`. La comprobación del día va primero.
  - En `finishStep`, el texto de consumo mayor que la reserva pasa a `OVER_RESERVATION_ERROR`.
  - En `daily.ts` se exportan `clockMinutes` y `dailyPlanKey`, que es la `planKey` de hoy con otro nombre.
  - `testing.md`: la migración nueva va en el paso 4 y en la nota de migraciones, con el aviso de aplicarla antes de desplegar.

- [ ] **Step 4: Run the tests**

  Run: `npx prisma generate && npx vitest run tests/agent-daily.test.ts tests/agent-database.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**: `feat(agent): record the minute tick and tell the daily budget apart`

---

### Task 2: La nota del dueño en «Rehacer»

**Files:**
- Modify: `src/lib/agent/queue.ts` (`changeRun`, `redo`)
- Modify: `src/lib/agent/agents/copy.ts` (`runCopy`, `runArticle`)
- Modify: `src/app/api/agent/[id]/route.ts`
- Test: `tests/agent-database.test.ts`, `tests/agent-route.test.ts`, `tests/agent-copy-design.test.ts`

**Interfaces:**
- Consumes: el `redo` actual (R10/R41 en sus comentarios).
- Produces:
  - `changeRun(businessId, runId, action, opts?: { note?: string })`.
  - En el contexto de la pieza se guarda `ownerNote: { round: number; text: string }`, donde `round` es el número de vuelta `n` de los pasos que agrega `redo`.
  - La API acepta `{ action: "redo", runId, note? }`, con `note` = `z.string().trim().max(500).optional()`.

- [ ] **Step 1: Write the failing tests**
  - DB `"Rehacer with a note: the round's copy step receives it as an owner problem; a second Rehacer is refused"`:
    1. Una pieza `waiting_approval` después de `review` aprobado.
    2. `changeRun(A, run, "redo", { note: "Menciona el seguro de inundación" })` → `context.ownerNote` es `{ round: n, text }`.
    3. Corre `copy-r<n>` con el modelo simulado → el prompt enviado contiene `"Menciona el seguro de inundación"`.
    4. Un segundo `changeRun(... "redo")` inmediato da `AgentError` (ya no espera).
  - DB `"Rehacer without a note keeps today's behavior"`: `ownerNote` queda `undefined` y no se agrega ningún problema del dueño en las notas.
  - Route:
    - `"redo with a 501-character note is 400"`.
    - `"redo passes the trimmed note to changeRun"` (se simula `changeRun` y se compara el cuarto argumento con `{ note: "x" }`).
  - Copy: `"the owner note of this round becomes a 'dueño' problem; a note of another round is ignored"`.

- [ ] **Step 2: Run them to verify they fail**

  Run: `npx vitest run tests/agent-route.test.ts tests/agent-copy-design.test.ts tests/agent-database.test.ts -t "Rehacer|redo|owner note"`
  Expected: FAIL.

- [ ] **Step 3: Implement**
  - `redo` recibe `note?: string`.
    - Si hay nota, el problema que manda a `reworkSteps` es `{ kind: "dueño", detail: note, sendBackTo: "copy" }`. Se agrega a los problemas de la revisión, o reemplaza el problema sintético cuando la revisión no tenía problemas.
    - Guarda `ownerNote` en el `context` refrescado (el `fresh` del R41). Una nota vacía o sin texto se ignora.
  - `runCopy`/`runArticle` en vuelta (`attempt >= 1`): si `context.ownerNote.round === input.step.attempt`, agregan `{ kind: "dueño", detail: text, sendBackTo: "copy" }` a `notes`.
  - La ruta pasa `{ note }` solo cuando la acción es `redo`.

- [ ] **Step 4: Run the tests**

  Run: el mismo comando del Step 2. Expected: PASS.

- [ ] **Step 5: Commit**: `feat(agent): the owner's note on Rehacer reaches the writer`

---

### Task 3: Vista del equipo (modelo puro y carga)

**Files:**
- Create: `src/lib/agent/team-view.ts`. Es puro y seguro para el cliente: no importa `db`, `agents/index` ni nada de `server-only`.
- Modify: `src/lib/agent/service.ts` (`teamSnapshot`, y `snapshot` con `team` y `runs` sin hijas)
- Modify: `src/components/agent/types.ts` (`Snapshot.team`, `settings` con `pausedAt`/`tickAt`)
- Test: `tests/agent-team-view.test.ts` (nuevo), `tests/agent-database.test.ts`

**Interfaces:**
- Consumes: `stepsOfPlan`, `isArticleStep` y `problemsOf` de `plan.ts`; `AgentKeyEnum` y `ModelChoice` de `schema.ts`; `resolveModel` de `models.ts` (solo en el servidor); `localDay`, `dayRange` y `businessTz`.
- Produces (en `team-view.ts`):

```ts
export type TeamStepView = { name: string; agent: string; model: string; attempt: number; status: string; output: Record<string, unknown> | null; error: string; chargedCents: number; createdAt: string; finishedAt: string | null };
export type TeamRunView = { id: string; kind: "team" | "piece"; origin: string; parentRunId: string | null; status: string; stage: number; plan: unknown; error: string; chargedCents: number; createdAt: string; message: string; steps: TeamStepView[] };
export type TeamAgentView = { key: string; label: { es: string; en: string }; usesModel: boolean; model: string; own: boolean; ready: boolean; problem: string; steps: number; cents: number };
export type TeamSnapshot = { today: string; tz: string; runs: TeamRunView[]; agents: TeamAgentView[] };
export const BOARD_COLUMNS = ["investigacion", "estrategia", "redaccion", "diseno", "revision", "programada", "publicada"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];
export type BoardState = "working" | "waiting" | "attention" | "done" | "cancelled";
export function currentStepId(run: TeamRunView): string | null;
export function boardColumn(run: TeamRunView): BoardColumn;
export function boardState(run: TeamRunView): BoardState;
export type NeedKind = "video" | "articulo" | "revision" | "publicar";
export type NeedItem = { runId: string; kind: NeedKind; topic: string; text: string; problems: { kind: string; detail: string }[]; canRedo: boolean };
export function needsYou(runs: TeamRunView[]): NeedItem[];
export function pieceInfo(run: TeamRunView): { topic: string; format: string; channels: string[] } | null;
```

- `loadTeamRuns(businessId: string, now = new Date()): Promise<{ today: string; tz: string; runs: TeamRunView[] }>` y `teamSnapshot(businessId: string, now = new Date()): Promise<TeamSnapshot>` en `service.ts`. `teamSnapshot` usa `loadTeamRuns`, y las alertas (Task 7) y el reporte (Task 8) también lo usan.

**Reglas que fijan las pruebas:**
- **`currentStepId`:**
  - Para una pieza es `plan.steps[stage].id`.
  - Para un encargo de equipo es `["plan","research","strategy","dispatch"][stage]`.
  - Da `null` si la etapa se pasó del final o si el plan no se puede leer.
- **`boardColumn`:**

  | Encargo | Paso actual o situación | Columna |
  |---|---|---|
  | team | `plan`, `research` | `investigacion` |
  | team | `strategy`, `dispatch`, o encargo terminado | `estrategia` |
  | piece | `copy*` o `article*` | `redaccion` |
  | piece | `design*`, `video`, `render` o `video_wait*` | `diseno` |
  | piece | `review*` | `revision` |
  | piece | `prepare`, `schedule`, `article_publish` o `verify` | `programada` |
  | piece | `waiting_approval` en `prepare`, `schedule` o `article_publish` | `revision` |
  | piece | etapa al final y `completed` | `publicada` |
  | piece | id desconocido o plan ilegible | `redaccion` |

- **`boardState`:**

  | Estado del encargo | `boardState` |
  |---|---|
  | `queued`, `running`, `waiting_provider` | `working` |
  | `waiting_approval` | `waiting` |
  | `blocked`, `uncertain` | `attention` |
  | `completed` | `done` |
  | `cancelled` | `cancelled` |

- **`needsYou`:** solo encargos `waiting_approval`, en orden de `createdAt`.
  - El tipo sale del paso donde espera la pieza:

    | Paso donde espera | `kind` |
    |---|---|
    | `render` | `video` |
    | `article*`, o `article_publish` con el último paso `article_publish:<n>` hecho (la foto con precio) | `articulo` |
    | después de una revisión con `approved: false` | `revision` |
    | cualquier otro | `publicar` |

  - Además:
    - `problems` = `problemsOf` de la última revisión.
    - `canRedo` = el paso anterior cumple `/^review(-r\d+)?$/` y el que espera no es `article*`, igual que la regla de `redo`.
    - `text` = `run.message`, que es el último mensaje `assistant` del encargo.
- **`teamSnapshot`:**
  - Carga los encargos `kind ∈ {team, piece}` creados hoy (en el `dayRange` del día local), más los abiertos (`OPEN_STATUSES`) de cualquier día, como máximo 40 y ordenados por `createdAt` ascendente.
  - Para cada encargo trae sus pasos y su mensaje `assistant`.
  - Para cada clave de `AgentKeyEnum` arma `agents`:
    - `label` es el de `AGENTS` (en el servidor) y `usesModel` también.
    - `model` es `provider:model` (el elegido o el de `MATYA_AGENT_*`), o `""` si el agente no usa IA.
    - `own` es verdadero si el negocio eligió un modelo para ese agente (`agentModels[key]` válido).
    - `ready`/`problem` salen de `resolveModel` dentro de un try/catch: el mensaje de `AgentError` queda en `problem`.
    - `steps`/`cents` cuentan los `AgentStep` con `agent = key` y `budgetDay = today`.
- **`snapshot`:**
  - Agrega `team: await teamSnapshot(...)` cuando hay workspace con `teamMode`; si no, `team: null`.
  - Su consulta de `runs` agrega `parentRunId: null`.

- [ ] **Step 1: Write the failing tests** en `agent-team-view.test.ts`. Hay un `it` por cada fila de las tablas de arriba, con encargos construidos a mano:
  - `"a piece at copy-r2 is in redaccion"`, `"a piece waiting at schedule after an approved review is in revision and needs 'publicar'"`, `"a piece at render waiting is a 'video' need without redo"`, `"a failed second review is a 'revision' need with its problems and redo"`, `"a completed piece is publicada/done"`, `"a piece with plan null is in redaccion and does not throw"`, `"a team run at research is in investigacion"`.

  Además, en la base de datos:
  - `"teamSnapshot: today's team and pieces, an open piece from yesterday, agents with steps and cents of today"`, con `MATYA_AGENT_*` falsos en `process.env` dentro de la prueba.
  - `"teamSnapshot of a team-mode business with nothing today is empty lists and seven agents"`.
  - `"snapshot's recent runs leave child pieces out"`.
  - `"a run created at 23:30 local yesterday and already completed is not today's"`, para un negocio en `America/New_York` con el reloj falso a las 00:10 local.

- [ ] **Step 2: Run them to verify they fail**

  Run: `npx vitest run tests/agent-team-view.test.ts`
  Expected: FAIL, el módulo no existe.

- [ ] **Step 3: Implement** `team-view.ts`, `teamSnapshot` y los cambios de `snapshot` y `types.ts`.

- [ ] **Step 4: Run the tests**

  Run: `npx vitest run tests/agent-team-view.test.ts tests/agent-database.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**: `feat(agent): team view model and snapshot`

---

### Task 4: Pestaña Hoy (tablero, «Necesita tu sí» y detalle de la pieza)

**Files:**
- Create: `src/components/agent/shared.tsx`. Saca `usd`, `safeHref`, `labels`, `stepNames` y `Output` de `AgentCenter.tsx` sin cambiar cómo se ven, y `AgentCenter` pasa a importarlos de ahí.
- Create: `src/components/agent/TeamToday.tsx`
- Create: `src/components/agent/Team.module.css`
- Modify: `src/components/agent/AgentCenter.tsx` (pestaña `today` y `stepNames` de los pasos nuevos)
- Test: `tests/agent-team-today.test.tsx` (nuevo)

**Interfaces:**
- Consumes: `Snapshot.team` y las funciones de Task 3; `mutate(body)` de `AgentCenter`.
- Produces:

  ```tsx
  export function TeamToday(props: { data: Snapshot; busy: boolean; act: (body: Record<string, unknown>) => Promise<boolean> }): JSX.Element
  ```

**Qué muestra, en este orden:**
1. **Avisos:**
   - Si `settings.pausedAt` tiene fecha: «MATYA está en pausa desde {hora}» y el botón «Reanudar» (`{ action: "resume_all" }`).
   - Si `tickAt` es nulo o tiene más de 10 minutos: «El llamado de cada minuto no está activo: el equipo no avanza ni llega el plan de la mañana.» y un enlace a «Ver configuración».
2. **El plan de hoy:**
   - Del encargo de equipo de hoy con `origin: "daily"` se muestra `goal`, que sale de la salida del paso `plan`, y «{n} piezas».
   - Si no hay plan: «El plan de hoy llega a las {dailyHour}:00.».
3. **«Necesita tu sí»:**
   - Una tarjeta por cada `NeedItem`, con el tipo como etiqueta: «Video con costo», «Artículo», «No pasó la revisión», «Lista para publicar».
   - Muestra el tema, `text` y la lista de `problems`.
   - Botones:
     - «Aprobar» (`approve`).
     - «Rehacer», solo si `canRedo`. Abre un `<textarea maxLength={500}>` «Qué quieres que cambie (opcional)» y «Rehacer esta pieza», que manda `{ action: "redo", runId, note }`.
     - «Cancelar» (`cancel`).
   - Sin elementos: «Nada espera tu aprobación.».
4. **Tablero:**
   - Siete columnas con los títulos «Investigación», «Estrategia», «Redacción», «Diseño o video», «Revisión», «Programada» y «Publicada».
   - Cada tarjeta muestra el tema, el formato, los canales, el estado (`labels`) y el costo.
   - Cada tarjeta es un `<details>`. Al abrirlo muestra el detalle de la pieza: por cada paso, `stepNames`, el agente (etiqueta de `team.agents`), el modelo, el costo, el estado, el error y `<Output>`.
   - Sin piezas: «Hoy todavía no hay piezas.».

**Pestaña:** la pestaña «Hoy» (`today`) va después de «Conversación» y existe solo si `settings.teamMode`.

**`stepNames` nuevos:**

| Clave | Español | Inglés |
|---|---|---|
| `plan` | Plan del Director | Director's plan |
| `strategy` | Estrategia | Strategy |
| `dispatch` | Piezas creadas | Pieces created |
| `review` | Revisión editorial | Editorial review |
| `render` | Generación del video | Video render |
| `article` | Artículo | Article |
| `article_publish` | Publicación en la web | Website publishing |

Las vueltas (`-r<n>`) usan el nombre base y agregan « (vuelta n)».

- [ ] **Step 1: Write the failing tests** (`renderToStaticMarkup` y CSS Modules simulados; `useT()` sin proveedor ya da español, porque `LangContext` vale `"es"` por defecto):
  - `"shows the pause banner with Reanudar when pausedAt is set"`.
  - `"shows the tick warning when tickAt is null or 11 minutes old, not when 2 minutes old"`.
  - `"each column title appears once and a piece at review is under Revisión"`.
  - `"a 'revision' need shows its problems, Aprobar, Rehacer and Cancelar; a 'video' need has no Rehacer"`.
  - `"an owner note with <script> is rendered escaped in a problem"`: `&lt;script&gt;` presente y `<script>` ausente.
  - `"empty team: 'Nada espera tu aprobación.' and 'Hoy todavía no hay piezas.'"`.
  - `"AgentCenter has no Hoy tab when teamMode is off"`.

- [ ] **Step 2: Run them to verify they fail**

  Run: `npx vitest run tests/agent-team-today.test.tsx`
  Expected: FAIL.

- [ ] **Step 3: Implement**
  - Las acciones de las tarjetas usan `act`.
  - «Rehacer» guarda la nota en un estado local de cada tarjeta.
  - Estilos en `Team.module.css`:
    - en ancho angosto, las columnas se muestran una debajo de otra (`flex-direction: column` por debajo de 720 px);
    - en ancho amplio, una grilla de 7 columnas con `minmax(0,1fr)` y `overflow-wrap: anywhere` en las tarjetas.

- [ ] **Step 4: Run the tests**

  Run: `npx vitest run tests/agent-team-today.test.tsx tests/youtube-fields.test.tsx`
  Expected: PASS.

- [ ] **Step 5: Commit**: `feat(agent): Hoy tab with the team board and Necesita tu sí`

---

### Task 5: Pestaña Equipo

**Files:**
- Create: `src/components/agent/TeamRoster.tsx`
- Modify: `src/components/agent/AgentCenter.tsx` (pestaña `team`, «Equipo», después de «Hoy», solo con `teamMode`)
- Modify: `src/components/agent/Team.module.css`
- Test: `tests/agent-team-today.test.tsx` (un `describe` más)

**Interfaces:**
- Consumes: `Snapshot.team.agents` y `Snapshot.budget`.
- Produces: `export function TeamRoster(props: { data: Snapshot }): JSX.Element`.

**Qué muestra:**
- Una fila por agente, en el orden de `AgentKeyEnum`, con su etiqueta.
- La IA:
  - `model` si el agente usa IA;
  - «Sin IA (biblioteca y plantillas)» para Diseño y Video;
  - «Usa el modelo por defecto» cuando no tiene uno elegido (`own` falso).
- «Listo», o el texto de `problem` marcado como aviso.
- «{steps} pasos hoy» y `usd(cents)`.
- Al final, el total del día del equipo: la suma de `cents`, frente a `usd(settings.dailyBudgetCents)`.

- [ ] **Step 1: Write the failing tests**:
  - `"lists the seven agents in order with their model or 'Sin IA'"`.
  - `"an agent with a problem shows the message"`.
  - `"the total adds the agents' cents"`.
- [ ] **Step 2: Run** `npx vitest run tests/agent-team-today.test.tsx -t Equipo`. Expected: FAIL.
- [ ] **Step 3: Implement** el componente y la pestaña.
- [ ] **Step 4: Run** el mismo comando. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(agent): Equipo tab with each agent's AI and spend`

---

### Task 6: Configuración del modo equipo y «Pausar todo»

**Files:**
- Create: `src/components/agent/TeamSettings.tsx`
- Modify: `src/components/agent/AgentSettings.tsx`. La sección se pone después de los interruptores de hoy, y `AgentSettings` recibe `act` para «Pausar todo».
- Modify: `src/lib/agent/settings-input.ts`, para agregar `readRate` y `formatRate`.
- Test: `tests/agent-settings-input.test.ts`, `tests/agent-team-settings-ui.test.tsx` (nuevo)

**Interfaces:**
- Consumes: `Settings` (`teamMode`, `dailyHour`, `agentModels`, `modelPrices`, `allowSocial`, `allowWebArticles`); `Snapshot.team.agents`; `settings.pausedAt`/`tickAt`.
- Produces:
  - `readRate(text: string): number | null`. Lee dólares por millón con punto o coma decimal y hasta 4 decimales. Debe ser mayor que 0 y como máximo 2000. Si no cumple, devuelve `null`.
  - `formatRate(n: number): string`. Muestra el número sin ceros de sobra (`0.15` → `"0.15"`).
  - `setAgentModel(models: Settings["agentModels"], agent: string, choice: { provider: string; model: string } | null): Settings["agentModels"]`. Con `null`, quita la entrada del agente.
  - `pruneModelPrices(prices: Settings["modelPrices"], models: Settings["agentModels"]): Settings["modelPrices"]`. Deja solo los precios de los modelos elegidos.
  - `export function TeamSettings(props: { value: Settings; set: <K extends keyof Settings>(k: K, v: Settings[K]) => void; data: Snapshot; busy: boolean; act: (body: Record<string, unknown>) => Promise<boolean>; onInvalid: (key: string, bad: boolean) => void }): JSX.Element`.

**Qué muestra la sección «Modo equipo»:**
- **Interruptores:**
  - «Modo equipo». Explica: «El Director arma un plan cada mañana y reparte las piezas entre los agentes.».
  - Cuando el interruptor está encendido y `tickAt` es nulo o tiene más de 10 minutos: «El llamado de cada minuto no está activo. Sin él no avanza ningún paso ni llega el plan de la mañana.».
- **Hora del plan:** un `<select>` «Hora del plan de la mañana» con 0–23, mostrado como `7:00 a. m.`/`7:00 p. m.` y con la zona del negocio.
- **Permisos:** «Publicar en redes sociales» (`allowSocial`) y «Publicar artículos en la web» (`allowWebArticles`).
- **IA de cada agente que la usa** (director, seo, strategy, copy, review):
  - Un `<select>` de proveedor con «Modelo por defecto», «OpenAI», «Claude» y «Gemini».
  - Un `<input>` de modelo; con proveedor «Modelo por defecto» no se muestra.
  - El estado que da el servidor («Listo» o `problem`). Puede quedar viejo hasta que se guarde; se indica con «después de guardar».
- **Precios:** por cada `provider:model` elegido, dos campos, «Entrada (USD por millón de tokens)» y «Salida (USD por millón de tokens)».
  - Usan `readRate`.
  - Un campo vacío o inválido bloquea «Guardar», con el mismo mecanismo de `invalid` de `AgentSettings`; `onInvalid` lo comunica.
  - Al guardar, se aplica `pruneModelPrices`.
- **Pausa:** fuera de los campos que se guardan, en un bloque propio con botones `type="button"`:
  - «Pausar todo» pide confirmar («Se cancela todo lo abierto y lo programado vuelve a borrador. ¿Pausar?») y manda `{ action: "pause_all" }`.
  - Si ya está en pausa, muestra «En pausa desde {hora}» y «Reanudar» (`resume_all`).

- [ ] **Step 1: Write the failing tests**:
  - `readRate`:
    - `"0.15"` → 0.15, `"2,5"` → 2.5 y `"$3"` → 3;
    - `""`, `"0"`, `"abc"`, `"0.00001"` y `"2001"` → `null`.
  - `setAgentModel` quita con `null`.
  - `pruneModelPrices` deja solo los precios en uso.
  - UI:
    - `"the section shows Modo equipo, the hour select with 24 options, both permissions and five model rows"`.
    - `"choosing a model shows its two price fields"` (con el valor inicial).
    - `"the tick warning shows only with teamMode on and a stale tick"`.
    - `"paused: 'En pausa desde' and Reanudar instead of Pausar todo"`.
- [ ] **Step 2: Run** `npx vitest run tests/agent-settings-input.test.ts tests/agent-team-settings-ui.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**
  - Conecta en `AgentSettings`: pasa `set`, el valor, `act` (desde `AgentCenter`, el mismo `mutate`) y un `onInvalid` que agrega o quita la clave en `invalid`.
  - Antes de `save(value)` aplica `pruneModelPrices`.
- [ ] **Step 4: Run** el mismo comando. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(agent): team mode settings, model prices and Pausar todo`

---

### Task 7: Alertas por email

**Files:**
- Create: `src/lib/agent/alerts.ts`
- Modify: `src/lib/agent/service.ts`. En la vuelta global, después del `drain`, llama a `sendAgentAlerts(new Date())` dentro de try/catch.
- Test: `tests/agent-alerts.test.ts` (nuevo, puro), `tests/agent-database.test.ts`

**Interfaces:**
- Consumes:
  - `needsYou`, `TeamRunView` y `loadTeamRuns` (Task 3);
  - `brakedOf` (guard.ts);
  - `DAY_BUDGET_ERROR`, `OVER_RESERVATION_ERROR` y `dailyPlanKey` (Task 1);
  - `sendSeoEmail`, `SenderConfigError`, `dailyRecipients`, `emailLang`, `publicBase` y `locked`.
- Produces:

```ts
export type AlertType = "video" | "revision" | "freno" | "presupuesto" | "apagado" | "plan";
export type AlertFact = { type: AlertType; key: string; text: { es: string; en: string } };
export function alertFacts(input: { day: string; runs: TeamRunView[]; braked: { channel: string; savedAt: string }[]; dayBudgetBlocked: boolean; selfDisabled: { runId: string } | null; dailyRun: { status: string } | null }): AlertFact[];
export function buildAlertEmail(business: { id: string; name: string }, facts: AlertFact[], lang: "es" | "en", base: string): { subject: string; html: string; text: string };
export const ALERTS_PER_DAY = 5;
export async function sendAgentAlerts(now?: Date, opts?: { max?: number }): Promise<{ sent: number; skipped: number; errors: number }>;
```

**Reglas:**
- **Claves de cada hecho:**

  | Situación | `type` | `key` |
  |---|---|---|
  | `needsYou` de tipo `video` | `video` | `video:<runId>` |
  | `needsYou` de tipo `revision` (ya no pasó dos veces) | `revision` | `revision:<runId>:<id de la revisión fallida>` |
  | Cada canal frenado | `freno` | `freno:<canal>:<savedAt>`, donde `savedAt` es el `updatedAt` de su conexión, o `"nunca"` |
  | Algún encargo de equipo o pieza quedó `blocked` hoy con `DAY_BUDGET_ERROR` | `presupuesto` | `presupuesto:<día>` |
  | El workspace está `enabled: false` y hay un encargo con `OVER_RESERVATION_ERROR` en las últimas 24 h | `apagado` | `apagado:<runId>` |
  | El encargo de `dailyPlanKey(business, hoy)` está `blocked` o `uncertain` | `plan` | `plan:<día>` |

- **Envío (`sendAgentAlerts`):**
  - Recorre como máximo `max` (por defecto 5) workspaces con `teamMode`, `enabled` o no, ordenados por `businessId`. Cada uno va en su propio try/catch.
  - Solo cuentan los hechos cuya `key` no está en las filas `SeoReport` `kind: "agent_alert"` de los últimos 30 días.
  - Dentro de `locked(businessId)`:
    - si `AgentBudget.alerts` del día es mayor o igual a `ALERTS_PER_DAY`, se salta;
    - si no, crea la fila con `data: { version: 1, day, keys, types, state: "sending", to, subject }` y suma 1 a `alerts`.
  - Fuera del lock manda **un** email con todos los hechos nuevos, agrupados por tipo.
  - Si sale bien, la fila queda con `state: "sent"` y `sentAt`.
  - Si falla, la fila queda con `state: "error"`, se resta 1 a `alerts` y no se reintenta, porque las claves ya están registradas.
  - Sin destinatarios, no crea nada y lo cuenta en `skipped`.
- **Asunto del email:**
  - En español: «MATYA te necesita: {etiqueta del primer tipo}», con « y {n} avisos más» si hay más.
  - En inglés: «MATYA needs you: …».
  - Las etiquetas son: «un video espera tu aprobación», «una pieza no pasó la revisión», «un canal salió del plan», «se acabó el presupuesto de hoy», «MATYA se apagó sola» y «el plan de la mañana se detuvo».
- **Cuerpo del email:** las secciones van por tipo, con la lista de textos y un botón «Abrir el Centro MATYA» que lleva a `${base}/b/${id}/matya`. Todo pasa por `escapeHtml`; hay que reutilizar el de `daily-report.ts` o exportarlo.

- [ ] **Step 1: Write the failing tests**
  - Puras:
    - `"alertFacts gives one fact per situation with the keys above"`.
    - `"two waiting videos are two video facts grouped in one email section"`.
    - `"buildAlertEmail escapes a topic with <b>"`.
    - `"subject with three types says 'y 2 avisos más'"`.
  - DB, con `sendSeoEmail` simulado:
    - `"a waiting video sends one alert; the next tick sends nothing new"`.
    - `"the sixth alert of the day is not sent (cap 5)"`.
    - `"a SenderConfigError leaves the record 'error', gives the cap back and is not retried; the other business still gets its alert"`.
    - `"teamMode off: no alerts"`.
- [ ] **Step 2: Run** `npx vitest run tests/agent-alerts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `alerts.ts` y la llamada en `runAgentCycle`, solo en la vuelta global y después del `drain`.
- [ ] **Step 4: Run** `npx vitest run tests/agent-alerts.test.ts tests/agent-database.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(agent): grouped email alerts for the team, five a day at most`

---

### Task 8: Sección MATYA del reporte diario

**Files:**
- Create: `src/lib/agent/daily-section.ts`
- Modify: `src/lib/daily-report.ts`. Los cambios:
  - `buildDailyEmail` recibe `opts.matya?`;
  - `sendDailyReport` carga la sección;
  - `runDailyReports` espera el plan y acepta `opts.teamOnly`.
- Modify: `src/lib/agent/service.ts`. En la vuelta global llama a `runDailyReports(new Date(), { max: 2, budgetMs: 15000, teamOnly: true })` dentro de try/catch.
- Test: `tests/agent-daily-section.test.ts` (nuevo), `tests/agent-database.test.ts`

**Interfaces:**
- Consumes: `TeamRunView`, `needsYou`, `pieceInfo` y `loadTeamRuns` (Task 3); `clockMinutes` y `dailyPlanKey` (Task 1); `PostTarget`/`PostMetric`.
- Produces:

```ts
export type MatyaDaily = {
  yesterday: { byChannel: { channel: string; posts: number }[]; reach: number; likes: number; comments: number; cents: number };
  today: { goal: string; pieces: { topic: string; format: string; channels: string[]; objective: string }[] } | null;
  needs: { topic: string; kind: string }[];
};
export function matyaReportReady(input: { teamMode: boolean; enabled: boolean; paused: boolean; tickAt: Date | null; dailyHour: number; tz: string; now: Date; dailyRunStatus: string | null }): boolean;
export async function loadMatyaDaily(businessId: string, reportDay: string, tz: string, now?: Date): Promise<MatyaDaily | null>; // null si teamMode está apagado
export function matyaSectionHtml(m: MatyaDaily, lang: "es" | "en", base: string, businessId: string, color: string): string;
export function matyaSectionText(m: MatyaDaily, lang: "es" | "en", base: string, businessId: string): string;
```

**Reglas:**
- **`matyaReportReady` es verdadero si se cumple cualquiera de estas condiciones:**
  - `!teamMode`, `!enabled` o `paused`;
  - `tickAt` es nulo o tiene más de 10 minutos;
  - `dailyRunStatus` es `completed`, `blocked`, `uncertain` o `cancelled`;
  - `clockMinutes(tz, now) >= (dailyHour + 3) * 60`.
- **Datos de la sección:**
  - **Ayer:**
    - Cuenta los `PostTarget` `sent` con `sentAt` dentro del día del reporte, de posts cuyo id empieza con `agent-`, agrupados por canal.
    - `reach`/`likes`/`comments` suman la última `PostMetric` de cada uno de esos `PostTarget`.
    - `cents` suma `AgentStep.chargedCents` con `budgetDay = reportDay` y `agent ≠ ""`.
  - **Hoy:**
    - Toma el encargo de `dailyPlanKey(business, hoy)`.
    - `goal` sale de la salida de su paso `plan`.
    - `pieces` sale de la salida de `dispatch.pieces` (`topic`, `format`, `channels` y `objective`).
    - Si no hay encargo, queda `null` y se muestra «El plan de hoy todavía no está listo.».
  - **Te necesita:** son los `needsYou` de los encargos de equipo abiertos.
- **Títulos y botón:** las tres partes se titulan «Ayer», «Hoy» y «Te necesita», y el botón «Abrir el Centro MATYA».
- **Cómo se integra en el reporte:**
  - `buildDailyEmail` agrega la sección después de las secciones de hoy, tanto en el HTML como en el texto.
  - `sendDailyReport` la carga con try/catch: si falla, el reporte sale sin ella.
  - `runDailyReports` calcula `matyaReportReady` antes de `claimDay` para cada negocio con modo equipo.
    - Si da falso, no reclama el día, cuenta en un nuevo campo `waiting` y sigue.
    - Con `teamOnly`, solo considera los negocios con `teamMode`.

- [ ] **Step 1: Write the failing tests**
  - Puras:
    - `matyaReportReady` con 6 casos, entre ellos 06:59 con `dailyHour` 4 = listo, 06:59 con `dailyHour` 5 = no, y un tick de hace 11 minutos = listo.
    - `"the section html escapes topics and lists Ayer, Hoy and Te necesita"`.
    - `"no plan yet says 'El plan de hoy todavía no está listo.'"`.
  - DB:
    - `"a team-mode report waits for the morning plan, then goes out with the MATYA section"`. Con el reloj falso a las 08:00 local, `dailyHour` 7, encargo de plan `running` y tick fresco, no sale; con el plan `completed`, sale y el HTML contiene «Hoy». `sendSeoEmail` va simulado.
    - `"teamMode off: the report is unchanged and has no MATYA section"`.
    - `"teamOnly skips businesses without team mode"`.
- [ ] **Step 2: Run** `npx vitest run tests/agent-daily-section.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `daily-section.ts`, los cambios de `daily-report.ts` y la llamada en `runAgentCycle`.
- [ ] **Step 4: Run** `npx vitest run tests/agent-daily-section.test.ts tests/agent-database.test.ts tests/report-period.test.ts`. Expected: PASS. Las pruebas actuales del reporte diario (`report-period.test.ts`) no cambian.
- [ ] **Step 5: Commit**: `feat(agent): MATYA section in the daily report, after the morning plan`

---

### Task 9: Documentación, datos de prueba y revisión en el navegador

**Files:**
- Modify: `docs/agent/README.md`. En la sección «Modo equipo» agrega «Pantallas» (Hoy, Necesita tu sí, Equipo, Configuración), «Avisos» (los seis tipos, el tope de 5 y a quién llegan) y «Reporte diario» (cuándo sale con modo equipo). También corrige la «nota del dueño» que hoy dice que viene en el PR 2.
- Modify: `scripts/agent-seed-local.mjs`. Para `matya-demo-fl` agrega:
  - `teamMode: true` y `tickAt: now`;
  - un encargo de equipo de hoy completado, con `plan`/`dispatch` en sus salidas;
  - tres piezas: una en `copy`, una `waiting_approval` después de una revisión fallida con dos problemas, y una `completed`;
  - un Administrador local `admin@matya.local`, con la contraseña de `MATYA_LOCAL_PASSWORD` (es obligatoria y el script se niega sin ella). Se guarda con el mismo formato de `src/lib/password.ts`, usando `node:crypto` `scrypt`.
  - El script sigue negándose a cualquier base que no sea la local.
- Create: `scripts/agent-ui-check.mjs`. Con Playwright (`executablePath: '/opt/pw-browsers/chromium'` si hace falta):
  - entra por `/login`, abre `/b/matya-demo-fl/matya` y recorre Hoy, Equipo y Configuración;
  - guarda capturas a 390 px y a 1280 px en el directorio que le pasen por argumento;
  - falla si `document.documentElement.scrollWidth > innerWidth`.
- Modify: `docs/agent/testing.md`, con cómo correr el seed y la revisión de pantallas.

- [ ] **Step 1:** Escribe la documentación y el seed. Corre `node scripts/agent-seed-local.mjs` contra la base local con `MATYA_LOCAL_PASSWORD`. Expected: «ready».
- [ ] **Step 2:** Con `MATYA_AGENT_ENABLED=true`, `npm run dev` y la base local, corre `node scripts/agent-ui-check.mjs <dir>`. Expected: 6 capturas y ninguna con desplazamiento horizontal.
- [ ] **Step 3:** Corre `npx vitest run` dos veces con la base local, `npx tsc --noEmit`, `npx eslint` y `npm run build`. Expected: todo en verde.
- [ ] **Step 4: Commit**: `docs(agent): team screens and alerts; local seed and screen check`
