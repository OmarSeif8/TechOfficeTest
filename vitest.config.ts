import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Vitest config — aliases must match tsconfig.json paths.
// We override postcss to an empty config so the project's Tailwind 4 postcss
// plugin (which vitest cannot load standalone) doesn't break unit tests.
// Domain code is pure TypeScript and has no CSS imports.
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@domain": resolve(__dirname, "./src/domain"),
      "@shared": resolve(__dirname, "./src/shared"),
      "@services": resolve(__dirname, "./src/services"),
      "@infrastructure": resolve(__dirname, "./src/infrastructure"),
    },
  },
  css: {
    postcss: {}, // empty — disables loading of project postcss.config.mjs
  },
  test: {
    environment: "node",
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "src/**/*.test.ts",
    ],
    exclude: ["node_modules/**", ".next/**", "examples/**", "skills/**"],
    globals: true,
  },
});
