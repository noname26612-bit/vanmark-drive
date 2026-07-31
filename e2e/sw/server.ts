// Управление прод-сервером для SW-e2e (O9). Тест сам запускает `next start` на порту 3100 и гасит его,
// чтобы эмулировать офлайн честной остановкой процесса (мёртвый порт валит и fetch из service worker,
// в отличие от ненадёжного Playwright setOffline). Прод-бандл с NEXT_PUBLIC_SW_CACHE=on собирает
// команда `pnpm e2e:sw` перед прогоном; здесь только жизненный цикл процесса.
import { spawn, type ChildProcess } from "node:child_process";

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
let proc: ChildProcess | null = null;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Поднять `next start -p 3100` и дождаться готовности (health ok). Идемпотентно. */
export async function startServer(): Promise<void> {
  if (proc) return;
  // Порт занят ЧУЖИМ процессом (зомби прошлых прогонов)? Наш spawn умрёт с EADDRINUSE, а isUp()
  // отвечал бы «жив» от чужого сервера СО СТАРОЙ сборкой (статика 500/404) — весь прогон падал бы
  // загадочно (поймано 31.07: next-server висел с 3 июля). Лучше честная ошибка сразу.
  if (await isUp()) {
    throw new Error(`SW e2e: порт ${PORT} уже занят чужим процессом — убейте его (lsof -nP -iTCP:${PORT})`);
  }
  // Бинарь next запускаем НАПРЯМУЮ, без pnpm-обёртки: SIGKILL по pnpm не убивал дочерний
  // next-server — тот осиротевал, жил вечно (найден зомби от 03.07) и делал «офлайн» фикцией,
  // а следующий прогон стучался в чужой старый сервер (статика 500) и падал весь.
  proc = spawn("node_modules/.bin/next", ["start", "-p", String(PORT)], {
    env: { ...process.env, NEXT_PUBLIC_SW_CACHE: "on", GEOCODER_PROVIDER: "none" },
    stdio: "ignore",
    detached: false,
  });
  for (let i = 0; i < 60; i++) {
    if (await isUp()) return;
    await sleep(1000);
  }
  throw new Error("SW e2e: сервер не поднялся на :3100 за 60 с");
}

/** Погасить сервер и дождаться, пока порт реально перестанет отвечать (эмуляция офлайна). */
export async function stopServer(): Promise<void> {
  if (!proc) return;
  const p = proc;
  proc = null;
  p.kill("SIGKILL");
  for (let i = 0; i < 30; i++) {
    if (!(await isUp())) return;
    await sleep(500);
  }
  // Порт так и отвечает → «офлайн» не наступил (сервер пережил kill) — честно валим прогон,
  // иначе офлайн-тесты дальше молча проверяли бы ничего.
  throw new Error(`SW e2e: сервер на :${PORT} не остановился за 15 с — офлайн-эмуляция не сработала`);
}

// ——— Эмуляторы деградации сети (инцидент «висит на логотипе», 31.07) ———
// Оба слушают ТОТ ЖЕ порт 3100 (сначала stopServer!), чтобы SW стучался в них своими же URL.
import { createServer as createNetServer, type Server as NetServer, type Socket } from "node:net";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";

let stallServer: NetServer | null = null;
const stallSockets = new Set<Socket>();

/** «Висящая» сеть: соединение принимается, ответа не будет никогда (чёрная дыра TCP). */
export async function startStallServer(): Promise<void> {
  if (stallServer) return;
  stallServer = createNetServer((socket) => {
    stallSockets.add(socket);
    socket.on("close", () => stallSockets.delete(socket));
    socket.on("error", () => {});
    /* держим соединение открытым и молчим */
  });
  await new Promise<void>((resolve, reject) => {
    stallServer!.once("error", reject);
    stallServer!.listen(PORT, resolve);
  });
}

export async function stopStallServer(): Promise<void> {
  if (!stallServer) return;
  const s = stallServer;
  stallServer = null;
  for (const sock of stallSockets) sock.destroy();
  stallSockets.clear();
  await new Promise<void>((resolve) => s.close(() => resolve()));
}

let errorServer: HttpServer | null = null;

/** Окно деплоя: на любой запрос — 503 (как Caddy при перезапуске бэкенда). */
export async function startErrorServer(): Promise<void> {
  if (errorServer) return;
  errorServer = createHttpServer((req, res) => {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("Service Unavailable");
  });
  errorServer.on("connection", (sock) => sock.setNoDelay(true));
  await new Promise<void>((resolve, reject) => {
    errorServer!.once("error", reject);
    errorServer!.listen(PORT, resolve);
  });
}

export async function stopErrorServer(): Promise<void> {
  if (!errorServer) return;
  const s = errorServer;
  errorServer = null;
  s.closeAllConnections();
  await new Promise<void>((resolve) => s.close(() => resolve()));
}
