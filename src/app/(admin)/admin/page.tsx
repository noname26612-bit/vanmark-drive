import Link from "next/link";

// Хаб администрирования (Артём). Отсюда — на доску, сводку, KPI и справочники-настройки.
export default function AdminPage() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold text-neutral-900">Администрирование</h1>
      <p className="mt-1 text-sm text-neutral-500">Управление сервисом и быстрый переход к работе.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <AdminLink href="/board" title="Доска «Сегодня»" desc="Задачи дня по водителям" />
        <AdminLink href="/tasks" title="Заявки — редактирование" desc="Открыть любую заявку и изменить название и все поля" />
        <AdminLink href="/summary" title="Сводка" desc="Итоги по водителям за период, выгрузка" />
        <AdminLink href="/kpi" title="KPI / зарплата" desc="Зарплата, премии и штрафы по месяцам" />
        <AdminLink href="/admin/task-types" title="Настройка типов задач" desc="Справочник: названия, акт, норма времени, порядок" />
        <AdminLink href="/admin/capacity" title="Календарь загрузки — настройки" desc="База, рабочий день, скорость, пробки, специализация" />
        <AdminLink href="/admin/work-catalog" title="Работы (ведомость)" desc="Справочник работ для ведомости водителя" />
        <AdminLink href="/admin/pay" title="Настройка оплаты (KPI)" desc="Оклады, премии, веса штрафов, прогрессия" />
        <AdminLink href="/admin/drivers" title="Водители — доступ" desc="Кому разрешён вход (внешний перевозчик)" />
      </div>
    </main>
  );
}

function AdminLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
    >
      <div className="font-medium text-neutral-900">{title}</div>
      <div className="text-sm text-neutral-500">{desc}</div>
    </Link>
  );
}
