// POST /api/client-log — приём клиентских ошибок (наблюдаемость, 31.07). Тонкий handler:
// клэмп/лимит в src/domain/client-log.ts, вывод — одна JSON-строка в stdout (docker logs vanmark-app,
// tag:"client-log"). БД не трогаем. Всегda 204: канал fire-and-forget, клиент не ретраит.
// Принимаем и БЕЗ сессии (ошибка может случиться до входа) — личность пишем best-effort из сессии,
// никогда из тела (ARCHITECTURE §6).
import { auth } from "@/lib/auth";
import { sanitizeClientLog, checkRate, BODY_MAX } from "@/domain/client-log";

export async function POST(req: Request): Promise<Response> {
  try {
    // Оверсайз режем по Content-Length ДО чтения тела (не буферизуем мусор в память зря);
    // отсутствующий/лживый заголовок страхует повторная проверка длины прочитанного текста.
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > BODY_MAX) return new Response(null, { status: 204 });
    const raw = await req.text();
    if (raw.length > BODY_MAX) return new Response(null, { status: 204 });
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch {
      return new Response(null, { status: 204 });
    }
    const entry = sanitizeClientLog(body);
    if (!entry) return new Response(null, { status: 204 });

    const session = await auth().catch(() => null);
    const user = session?.user?.login ?? "anon";
    if (!checkRate(user)) return new Response(null, { status: 204 });

    console.error(
      JSON.stringify({
        tag: "client-log",
        at: new Date().toISOString(),
        user,
        ua: (req.headers.get("user-agent") ?? "").slice(0, 200),
        ...entry,
      }),
    );
  } catch {
    /* канал диагностики не должен ронять ничего */
  }
  return new Response(null, { status: 204 });
}
