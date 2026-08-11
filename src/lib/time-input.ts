// Умный разбор введённого времени для TimeField (решение Артёма 11.08.2026). Поддерживает:
//  • «16:30», «16.30», «16-30», «16 30» — с любым разделителем;
//  • «1630» — четыре цифры подряд, самый быстрый способ с клавиатуры;
//  • «930» — три цифры (9:30), «9» — один-два часа (09:00);
//  • «сейчас» — текущее время (для «закрыть смену сейчас, но задним числом» удобнее кнопки нет).
// Возвращает «ЧЧ:ММ» или null, если строку распознать не удалось (поле откатится к прежнему значению).
//
// Зачем: раньше это был нативный input[type=time]. В Safari он рисует сегменты «12:30 PM» с иконкой,
// и попасть курсором по часам/минутам физически трудно — Милена не могла указать время закрытия
// смены. Разбор текста снимает проблему целиком и работает одинаково во всех браузерах.

function hhmm(h: number, m: number): string | null {
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * @param raw   что напечатал пользователь
 * @param nowHHMM текущее время «ЧЧ:ММ» — только для слова «сейчас» (передаётся снаружи, чтобы
 *                функция осталась чистой и тестируемой)
 */
export function parseTimeInput(raw: string, nowHHMM?: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;

  if (s === "сейчас" && nowHHMM) return parseTimeInput(nowHHMM);

  // С разделителем: 16:30, 16.30, 16-30, 9:5 → 09:05
  const sep = /^(\d{1,2})[:.\-](\d{1,2})$/.exec(s);
  if (sep) return hhmm(Number(sep[1]), Number(sep[2]));

  // Только цифры: 1630 → 16:30, 930 → 09:30, 9 → 09:00, 16 → 16:00
  const digits = /^(\d{1,4})$/.exec(s);
  if (digits) {
    const d = digits[1];
    if (d.length <= 2) return hhmm(Number(d), 0);
    if (d.length === 3) return hhmm(Number(d.slice(0, 1)), Number(d.slice(1)));
    return hhmm(Number(d.slice(0, 2)), Number(d.slice(2)));
  }

  return null;
}

/** Уже готовое «ЧЧ:ММ» (то, что хранит и ждёт сервер) — по нему решаем, можно ли коммитить на лету. */
export function isCompleteTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
