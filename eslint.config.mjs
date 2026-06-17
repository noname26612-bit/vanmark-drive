import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Сгенерированный код (Prisma client) — не линтуем.
    "src/generated/**",
    // Service worker (Этап 5) — рантайм-глобали self/clients, отдаётся как статика.
    "public/sw.js",
    // Локальные git-воркти этапов и файлы скиллов — не проектный исходник (в CI их нет).
    ".claude/**",
  ]),
]);

export default eslintConfig;
