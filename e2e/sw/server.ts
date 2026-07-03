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
  proc = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], {
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
}
