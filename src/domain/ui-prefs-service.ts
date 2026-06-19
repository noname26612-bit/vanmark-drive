// Хранилище настроек интерфейса пользователя (доступ к БД). Чистая логика — в src/domain/ui-prefs.ts.
// Изоляция (CLAUDE.md правило 1): userId приходит ТОЛЬКО из сессии — чужие настройки недоступны
// (нет ручки, принимающей userId извне).
import { prisma } from "@/lib/prisma";
import { type UiPrefKey, type UiPrefs, isUiPrefKey, sanitizeKeyArray, emptyUiPrefs } from "./ui-prefs";

/** Все настройки интерфейса пользователя одним объектом (с дефолтами-пустышками). */
export async function getUiPrefs(userId: string): Promise<UiPrefs> {
  const rows = await prisma.uiPreference.findMany({ where: { userId } });
  const out = emptyUiPrefs();
  for (const r of rows) {
    if (isUiPrefKey(r.key)) out[r.key] = sanitizeKeyArray(r.value);
  }
  return out;
}

/** Сохранить одну настройку. Значение санируется. userId — из сессии. */
export async function setUiPref(userId: string, key: UiPrefKey, value: unknown): Promise<string[]> {
  const clean = sanitizeKeyArray(value);
  await prisma.uiPreference.upsert({
    where: { userId_key: { userId, key } },
    update: { value: clean },
    create: { userId, key, value: clean },
  });
  return clean;
}
