import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // tsconfig tiene jsx "preserve" (lo compila Next); en las pruebas los .tsx (el PDF) usan el JSX automático de React.
  oxc: { jsx: { runtime: "automatic" } },
  test: { environment: "node" },
});
