// Требования к паролю при админ-сбросе (03.08.2026). Чистый модуль — юнит-тесты без argon2.
//
// Смена пароля из админки появилась ради нештатных исполнителей: раньше пароль можно было задать
// только сидом или запросом к базе, поэтому выдать доступ новому перевозчику без разработчика
// было невозможно.
import { Errors } from "./errors";

export const MIN_PASSWORD_LEN = 8;
// Верхняя граница — защита от длинного ввода: argon2 считает хэш тем дольше, чем длиннее строка.
export const MAX_PASSWORD_LEN = 72;

/** Проверить пароль. Не проходит — доменная ошибка с человеческим текстом. */
export function assertPasswordStrength(plain: string, login: string): void {
  const value = plain ?? "";
  if (value.trim().length === 0) throw Errors.validation("Введите пароль");
  if (value.length < MIN_PASSWORD_LEN) {
    throw Errors.validation(`Пароль короче ${MIN_PASSWORD_LEN} символов`);
  }
  if (value.length > MAX_PASSWORD_LEN) {
    throw Errors.validation(`Пароль длиннее ${MAX_PASSWORD_LEN} символов`);
  }
  if (value.toLowerCase() === (login ?? "").toLowerCase()) {
    throw Errors.validation("Пароль не должен совпадать с логином");
  }
}
