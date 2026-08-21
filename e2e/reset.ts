// Сброс «зависших» активных задач перед e2e-тестами. Нужен из-за правила «одна активная задача»
// (этап B): тесты делят ОДНУ dev-БД и общий ростер водителей, поэтому накопленные/оставленные
// прошлыми тестами задачи в IN_PROGRESS иначе дают 409 ACTIVE_TASK_EXISTS при взятии в работу.
// Перед каждым тестом гасим все IN_PROGRESS → DONE: водители стартуют без активной задачи.
//
// Доступ к БД — через `docker exec` в контейнер Postgres (как в docker-compose проекта), чтобы не
// тянуть драйвер БД в e2e: generated Prisma client несовместим с ESM-загрузчиком playwright, а
// добавлять отдельный pg-пакет ради теста не хотим (CLAUDE.md правило 6). e2e гоняются локально.
import { execSync } from "node:child_process";

const CONTAINER = process.env.POSTGRES_CONTAINER ?? "vanmark-postgres";

function psql(sql: string): void {
  execSync(`docker exec ${CONTAINER} psql -U vanmark -d vanmark -c "${sql}"`, { stdio: "ignore" });
}

// Подготовка водителей к взятию задач: (1) гасим зависшие IN_PROGRESS (правило «одна активная»);
// (2) открываем смену на сегодня каждому водителю — иначе взятие в работу даёт SHIFT_REQUIRED
// (этап D: работать можно только при открытой смене).
// День смены — МОСКОВСКИЙ (как shiftDateOf в домене): CURRENT_DATE постгреса — UTC-день, и в окно
// 00:00–03:00 МСК он «вчерашний» → клиент водителя (todayISO = МСК) не видел смену и ловил ложный
// SHIFT_REQUIRED (пойман ночным прогоном 21.07.2026).
export async function resetActiveTasks(): Promise<void> {
  psql(`UPDATE \\"Task\\" SET status='DONE', \\"completedAt\\"=now() WHERE status='IN_PROGRESS'`);
  psql(
    `INSERT INTO \\"Shift\\" (id,\\"driverId\\",date,status,\\"openedAt\\",\\"createdAt\\") ` +
      `SELECT gen_random_uuid(),u.id,(now() AT TIME ZONE 'Europe/Moscow')::date,'OPEN',now(),now() FROM \\"User\\" u WHERE u.role='DRIVER' ` +
      `ON CONFLICT (\\"driverId\\",date) DO UPDATE SET status='OPEN'`,
  );
}

/**
 * Завести «зависшую» смену: открыта N дней назад и не закрыта (водитель забыл нажать «Закрыть смену»).
 * Обычным путём такую смену не создать — водитель может открыть смену только за сегодня. Возвращает id.
 * Время открытия — 09:00 МСК того дня.
 */
export async function insertStaleShift(driverLogin: string, daysAgo: number): Promise<string> {
  const day = `((now() AT TIME ZONE 'Europe/Moscow')::date - ${daysAgo})`;
  const sql =
    `INSERT INTO \\"Shift\\" (id,\\"driverId\\",date,status,\\"openedAt\\",\\"createdAt\\") ` +
    `SELECT gen_random_uuid(),u.id,${day},'OPEN',` +
    `(${day} + time '09:00') AT TIME ZONE 'Europe/Moscow',now() ` +
    `FROM \\"User\\" u WHERE u.login='${driverLogin}' ` +
    `ON CONFLICT (\\"driverId\\",date) DO UPDATE SET status='OPEN', \\"closedAt\\"=NULL, \\"closedById\\"=NULL ` +
    `RETURNING id`;
  const out = execSync(`docker exec ${CONTAINER} psql -U vanmark -d vanmark -t -A -c "${sql}"`, {
    encoding: "utf8",
  });
  const id = out.trim().split("\n")[0].trim();
  if (!id) throw new Error(`insertStaleShift: не удалось создать смену для ${driverLogin}`);
  return id;
}

/** Одно значение из БД (первая колонка первой строки). Пусто — вернём "". */
function psqlValue(sql: string): string {
  const out = execSync(`docker exec ${CONTAINER} psql -U vanmark -d vanmark -t -A -c "${sql}"`, {
    encoding: "utf8",
  });
  return out.trim().split("\n")[0].trim();
}

/**
 * id типа заявки по названию. Своего API у справочника типов нет (диспетчер получает его серверным
 * рендером страницы), а тестам, которые создают заявки запросом, id нужен — берём из БД тем же
 * способом, что и остальные подготовительные операции e2e.
 */
export async function taskTypeIdByName(name: string): Promise<string> {
  const id = psqlValue(`SELECT id FROM \\"TaskType\\" WHERE name='${name}'`);
  if (!id) throw new Error(`taskTypeIdByName: тип «${name}» не найден — выполните pnpm db:seed`);
  return id;
}

/** id пользователя по логину — для назначения исполнителя запросом. */
export async function userIdByLogin(login: string): Promise<string> {
  const id = psqlValue(`SELECT id FROM \\"User\\" WHERE login='${login}'`);
  if (!id) throw new Error(`userIdByLogin: пользователь ${login} не найден`);
  return id;
}

// Сброс смен (этап C): @@unique(driverId, date) — повторный прогон в тот же день иначе натыкается на
// смену прошлого теста. Удаляем все смены (в dev-БД они только тестовые).
export async function resetShifts(): Promise<void> {
  // Сначала чистим авто-кандидатов «поздно открыл смену»: при удалении смен ниже их KpiMark осиротевают
  // (shiftId → NULL, onDelete SetNull) и копятся в общей dev-БД, ломая ассерт hasShiftLate по driverId
  // в shift-adjust.spec (память проекта: ассерты вешать на уникальные данные). CONFIRMED/DISMISSED —
  // решения диспетчера — не трогаем, только авто-кандидаты (детектор их пересоздаёт).
  psql(`DELETE FROM \\"KpiMark\\" WHERE kind='SHIFT_LATE' AND status='CANDIDATE'`);
  psql(`DELETE FROM \\"Shift\\"`);
}
