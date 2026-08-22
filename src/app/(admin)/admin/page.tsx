import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getAdminOverview } from "@/domain/admin-overview-service";
import { StatTile } from "@/components/ui/stat-tile";
import { PRICING_ENABLED } from "@/lib/features";
import { CRON_JOBS, CRON_TZ } from "@/lib/cron-schedule";
import { formatDate } from "@/lib/task-ui";
import { RefreshButton } from "./_components/refresh-button";

export const dynamic = "force-dynamic";

/**
 * «Управление» (стартовый экран администратора, переработан 22.08.2026).
 *
 * Было: девять карточек-ссылок, часть разделов отсутствовала, и ничего живого — открыв экран,
 * администратор не узнавал ровным счётом ничего о состоянии дел.
 * Стало: сверху «Требует внимания» (живые числа со ссылками ровно туда, где это чинят), ниже все
 * разделы группами, в конце — «Система» (версия сборки, расписание рассылок, здоровье).
 *
 * Серверный компонент: интерактива тут нет, а данные собираются из тех же источников, что и
 * соответствующие экраны, — отдельного API заводить не за чем.
 */
export default async function AdminPage() {
  const user = await requireRole("ADMIN");
  const overview = await getAdminOverview(user);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Управление</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Что требует внимания сегодня, все разделы и состояние системы.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <RefreshButton />
          <span className="text-xs text-neutral-400">
            {formatDate(overview.todayKey)} · сборка {overview.system.buildVersion}
          </span>
        </div>
      </div>

      <section className="mt-6" data-testid="admin-attention">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Требует внимания
        </h2>
        {overview.tiles.length === 0 ? (
          <p className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-500">
            Всё спокойно: незакрытых смен, просрочек и неразобранных отметок нет.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {overview.tiles.map((t) => (
              <StatTile
                key={t.key}
                label={t.label}
                value={t.count}
                hint={t.hint}
                tone={t.tone}
                href={t.href}
                testId={`attention-${t.key}`}
              />
            ))}
          </div>
        )}
        {/* Источник не ответил — говорим об этом прямо: молча показанная неполная картина хуже,
            чем честное «часть данных не получена». */}
        {overview.failed.length > 0 ? (
          <p className="mt-2 text-xs text-amber-700">
            Не удалось получить: {overview.failed.join(", ")}. Числа неполные — обновите страницу.
          </p>
        ) : null}
      </section>

      <Group title="Работа">
        <AdminLink href="/board" title="Водители" desc="Задачи дня по водителям, смены, пометки простоя" />
        <AdminLink href="/staff" title="Цех" desc="Задачи сотрудникам: цех и снабжение" />
        <AdminLink href="/planning" title="Планирование" desc="Заявки на будущие дни" />
        <AdminLink href="/capacity" title="Календарь загрузки" desc="Сколько работы в каждом дне" />
        <AdminLink href="/tasks" title="Все задачи" desc="Поиск, фильтры, архив, правка любой заявки" />
      </Group>

      <Group title="Аналитика и деньги">
        <AdminLink href="/summary" title="Сводка" desc="Итоги по водителям за период, выгрузка CSV" />
        <AdminLink href="/kpi" title="KPI / Зарплата" desc="Расчёт по месяцам, отметки, история смен" />
        {PRICING_ENABLED ? (
          <AdminLink href="/pricing" title="Расценка" desc="Ведомости работ на расценку" />
        ) : null}
      </Group>

      <Group title="Оборудование">
        <AdminLink href="/machines" title="Листогибы" desc="Картотека, состояния, сроки, фото" />
        <AdminLink href="/seamers" title="Фальцепрокатники" desc="Второй раздел картотеки" />
      </Group>

      <Group title="Люди и доступ">
        <AdminLink href="/team" title="Команда" desc="Дни рождения, отпуска и больничные коллектива" />
        <AdminLink
          href="/admin/drivers"
          title="Пользователи и доступ"
          desc="Вход и пароли: офис и водители"
        />
      </Group>

      <Group title="Настройки">
        <AdminLink href="/admin/task-types" title="Типы задач" desc="Названия, акт, норма времени, порядок" />
        <AdminLink href="/admin/pay" title="Оплата (KPI)" desc="Оклады, премии, веса штрафов, прогрессия" />
        <AdminLink
          href="/admin/capacity"
          title="Календарь загрузки — настройки"
          desc="База, рабочий день, скорость, пробки"
        />
        <AdminLink href="/admin/work-catalog" title="Справочник работ" desc="Работы и цены для ведомости" />
      </Group>

      <section className="mt-6" data-testid="admin-system">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Система</h2>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <Fact label="Версия сборки" value={overview.system.buildVersion} />
            <Fact
              label="Подписки на уведомления"
              value={
                overview.system.pushSubscriptions === null
                  ? "—"
                  : String(overview.system.pushSubscriptions)
              }
            />
            <div className="flex flex-col">
              <span className="text-xs text-neutral-500">Здоровье сервиса</span>
              <a
                href="/api/health"
                className="font-medium text-neutral-800 underline-offset-2 hover:underline"
              >
                /api/health
              </a>
            </div>
          </div>

          <h3 className="mt-4 mb-2 text-xs font-medium text-neutral-500">
            Рассылки и фоновые задачи ({CRON_TZ})
          </h3>
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200">
            {CRON_JOBS.map((j) => (
              <li key={j.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <span className="w-12 shrink-0 tabular-nums font-medium text-neutral-800">{j.time}</span>
                <span className="text-neutral-600">{j.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-neutral-500">{label}</span>
      <span className="font-medium tabular-nums text-neutral-800">{value}</span>
    </div>
  );
}

function AdminLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-neutral-200 bg-white p-3.5 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
    >
      <div className="font-medium text-neutral-900">{title}</div>
      <div className="text-sm text-neutral-500">{desc}</div>
    </Link>
  );
}
