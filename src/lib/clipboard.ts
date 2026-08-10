// Копирование и системный шаринг текста (первый потребитель — «Задание в цех», PRD §16.6).
// Вызывать СИНХРОННО в обработчике клика: и clipboard, и share требуют transient activation —
// вызов после await сетевого запроса браузер молча отклонит.
//
// navigator.clipboard живёт только в secure context (https/localhost) — на проде и в TWA он есть;
// фолбэк через скрытый textarea покрывает остальное (например, dev по LAN-IP с телефона).

export function canNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // clipboard запрещён или недоступен — пробуем фолбэк ниже
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** «cancelled» (человек передумал в системном шите) — не ошибка и не повод писать событие. */
export async function shareText(text: string): Promise<"shared" | "cancelled" | "failed"> {
  try {
    await navigator.share({ text });
    return "shared";
  } catch (e) {
    return e instanceof DOMException && e.name === "AbortError" ? "cancelled" : "failed";
  }
}
