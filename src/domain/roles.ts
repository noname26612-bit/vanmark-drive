// Роли и куда отправлять пользователя после входа. Доменное правило — держим в одном месте,
// чтобы и редиректы, и guard'ы (src/lib/session.ts) брали маршрут отсюда, а не хардкодили.
// Берём enum из лёгкого сгенерированного файла enums (без рантайма Prisma-клиента),
// чтобы доменные модули и их тесты не тянули весь клиент.
import { Role } from "@/generated/prisma/enums";

export { Role };

/** Стартовый экран роли (после входа и при заходе на «/»). */
export function homeForRole(role: Role): string {
  switch (role) {
    case "ADMIN":
      return "/admin";
    case "DISPATCHER":
      return "/board";
    case "DRIVER":
      return "/m";
    case "SERVICE_MANAGER":
      // Менеджер-сервисник (Максим, 05.08.2026): весь его сервис — картотека станков (PRD §16).
      return "/machines";
    default: {
      // Если в enum добавят роль и забудут маршрут — упадёт типизация здесь.
      const exhaustive: never = role;
      return exhaustive;
    }
  }
}

/** Человекочитаемое название роли для интерфейса. */
export function roleLabel(role: Role): string {
  switch (role) {
    case "ADMIN":
      return "Администратор";
    case "DISPATCHER":
      return "Диспетчер";
    case "DRIVER":
      return "Водитель";
    case "SERVICE_MANAGER":
      return "Менеджер-сервисник";
    default: {
      const exhaustive: never = role;
      return exhaustive;
    }
  }
}
