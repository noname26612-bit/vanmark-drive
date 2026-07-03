// Штамп версии service worker (O9). Пишет public/sw-version.js с уникальным идентификатором сборки —
// sw.js подхватывает его через importScripts и кладёт в имя кэша (vanmark-app-<версия>). При каждом
// деплое версия меняется → activate чистит кэш прошлой сборки, устаревшие чанки не копятся вечно.
// Запускается автоматически как `prebuild` (npm/pnpm выполняет перед `build`). Чистый node, без
// зависимостей (CLAUDE.md правило 6). git sha — если .git доступен (в Docker он исключён .dockerignore),
// иначе фолбэк на текущее время сборки: и то, и другое уникально на сборку — этого достаточно.
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

let version;
try {
  version = execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch {
  version = "";
}
if (!version) version = `b${Date.now()}`;

const dir = join(process.cwd(), "public");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "sw-version.js"), `self.SW_VERSION = ${JSON.stringify(version)};\n`);
console.log(`[sw-version] ${version}`);
