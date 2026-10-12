// Red de seguridad: toda acción del servidor, página de un negocio y ruta debe revisar el permiso (src/lib/auth.ts).
// Si agregas una y esta prueba falla, empieza la función con requireBusiness/hasBusiness/businessAccess/pageBusiness.
// Solo lo que de verdad no usa un negocio va en las listas de abajo, con el motivo.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const APP = join(ROOT, "src/app");

/** Revisan el permiso de un negocio (o crean uno en la organización de la persona). */
const BUSINESS_GUARDS = ["requireBusiness", "hasBusiness", "businessAccess", "pageBusiness", "newBusinessOrganizationId", "requireAgentOwner", "eraseBusinessData", "disconnectGoogleData"];
/** Solo revisan que haya alguien (para lo que no es de un negocio). */
const USER_GUARDS = ["requireUser", "myBusinessesWhere", "getSessionUser"];

/** Acciones que no usan ningún negocio. */
const ACTIONS_WITHOUT_BUSINESS: Record<string, string> = {
  "actions.ts#logout": "solo borra la cookie de la sesión",
};

/** Rutas públicas que revisan su propio permiso (src/lib/access.ts). */
const PUBLIC_ROUTES: Record<string, string> = {
  "api/auth/login/route.ts": "entrar con correo y contraseña",
  "api/auth/google/start/route.ts": "empieza «Entrar con Google»",
  "api/auth/google/callback/route.ts": "regreso de «Entrar con Google»",
  "api/cron/route.ts": "el publicador automático, con su propia clave",
  "api/subir/[token]/firmar/route.ts": "subida de los técnicos, con el link privado del negocio",
  "api/subir/[token]/listo/route.ts": "subida de los técnicos, con el link privado del negocio",
  "icons/[size]/route.ts": "el ícono de la app",
  "media/[file]/route.ts": "fotos y videos que descargan Instagram, TikTok y Google",
};

/** Páginas que no son de un negocio pero sí necesitan sesión. */
const PUBLIC_PAGES = new Set(["login/page.tsx", "subir/[token]/page.tsx"]);

function files(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, keep) : keep(path) ? [path] : [];
  });
}

type Fn = { name: string; exported: boolean; body: string };

/** Las funciones de nivel superior del archivo (declaradas o con const = async …). */
function functions(path: string): Fn[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Fn[] = [];
  const exported = (n: ts.Node) => (ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  for (const st of source.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) out.push({ name: st.name.text, exported: exported(st), body: st.body.getText(source) });
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)))
          out.push({ name: d.name.text, exported: exported(st), body: d.initializer.body.getText(source) });
  }
  return out;
}

const calls = (body: string, names: string[]) => names.some((n) => new RegExp(`\\b${n}\\s*\\(`).test(body));

/** Los guardias del archivo: los de src/lib/auth.ts más las funciones del mismo archivo que los llaman. */
function guardsOf(fns: Fn[], base: string[]): string[] {
  const guards = new Set(base);
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of fns) if (!guards.has(f.name) && calls(f.body, [...guards])) (guards.add(f.name), (changed = true));
  }
  return [...guards];
}

const rel = (path: string) => relative(APP, path).split("\\").join("/");

describe("every entry point checks the permission", () => {
  it("server actions check the business (and its role) before doing anything", () => {
    const missing: string[] = [];
    for (const path of files(APP, (p) => /\/actions[^/]*\.ts$/.test(p))) {
      if (!readFileSync(path, "utf8").startsWith('"use server"')) continue;
      const fns = functions(path);
      const guards = guardsOf(fns, BUSINESS_GUARDS);
      for (const f of fns.filter((x) => x.exported)) {
        const key = `${rel(path)}#${f.name}`;
        if (!calls(f.body, guards) && !ACTIONS_WITHOUT_BUSINESS[key]) missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });

  it("business pages check the business; the other pages need someone signed in", () => {
    const missing: string[] = [];
    for (const path of files(APP, (p) => /\/page\.tsx$/.test(p))) {
      const key = rel(path);
      if (PUBLIC_PAGES.has(key)) continue;
      const fns = functions(path);
      const guards = key.startsWith("b/[id]/") ? guardsOf(fns, BUSINESS_GUARDS) : guardsOf(fns, [...BUSINESS_GUARDS, ...USER_GUARDS]);
      const page = fns.find((f) => f.exported && /^[A-Z]/.test(f.name)) ?? fns.find((f) => f.exported);
      if (!page || !calls(page.body, guards)) missing.push(key);
    }
    expect(missing).toEqual([]);
  });

  it("route handlers check the business, unless they are public on purpose", () => {
    const missing: string[] = [];
    for (const path of files(APP, (p) => /\/route\.tsx?$/.test(p))) {
      const key = rel(path);
      if (PUBLIC_ROUTES[key]) continue;
      const fns = functions(path);
      const guards = guardsOf(fns, BUSINESS_GUARDS);
      for (const f of fns.filter((x) => x.exported && /^(GET|POST|PUT|PATCH|DELETE|HEAD)$/.test(x.name))) if (!calls(f.body, guards)) missing.push(`${key}#${f.name}`);
    }
    expect(missing).toEqual([]);
  });
});
