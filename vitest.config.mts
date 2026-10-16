import { fileURLToPath } from "url";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * The suites that write the shared local database (127.0.0.1:55439/matya_agent; anywhere else they skip). Some of them run the
 * global tick over every business at once, so two of them at the same time can step on each other's fixtures: they run one file
 * at a time among themselves. Every other file stays parallel.
 */
const DATABASE_SUITES = ["tests/*-database.test.ts", "tests/agent-team-e2e.test.ts"];

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // tsconfig tiene jsx "preserve" (lo compila Next); en las pruebas los .tsx (el PDF) usan el JSX automático de React.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    projects: [
      { extends: true, test: { name: "unit", exclude: [...configDefaults.exclude, ...DATABASE_SUITES] } },
      {
        extends: true,
        test: {
          name: "database",
          include: DATABASE_SUITES,
          fileParallelism: false,
          // globalSetup: sets the demo of scripts/agent-seed-local.mjs aside while the database suites run (see tests/global-setup.ts).
          globalSetup: ["./tests/global-setup.ts"],
        },
      },
    ],
  },
});
