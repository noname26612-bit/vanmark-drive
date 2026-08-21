"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, Cake, Pencil, UserPlus } from "lucide-react";
import useSWR from "swr";
import { fetcher, apiSend, ApiError } from "@/lib/fetcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-field";
import { formatDateShort } from "@/lib/task-ui";
import { parsePhones } from "@/lib/phone";
import { roleLabel, type Role } from "@/domain/roles";

// Вкладка «Команда» (PRD §18, решение Артёма 18.08.2026): справочник коллектива — у кого когда
// день рождения и кто когда в отпуске. Экран диспетчерский: плотно, 14px, графит; цветом
// подсвечивается только то, что требует действия сейчас (сегодняшний день рождения — янтарный).
//
// Правка (canManage) — у всех, кому открыт раздел: диспетчер, админ и менеджер-сервисник
// (21.08.2026, решение Артёма). Флаг оставлен, а не выкинут: экран рисуется и на сервере, и правило
// «не показывать кнопку, ведущую в 403» должно остаться выраженным явно — если завтра раздел
// откроют кому-то на просмотр, менять придётся только белый список в team-access.ts.

type AbsenceKind = "VACATION" | "SICK" | "OTHER";

type Absence = {
  id: string;
  driverId: string;
  driverName: string | null;
  dateFrom: string;
  dateTo: string;
  type: AbsenceKind;
  note: string | null;
};

type Member = {
  id: string;
  name: string;
  position: string | null;
  phone: string | null;
  role: Role;
  birthday: string | null;
  canLogin: boolean;
  editable: boolean;
};

type Birthday = { id: string; name: string; date: string; inDays: number; label: string };

type Snapshot = {
  members: Member[];
  absences: Absence[];
  birthdays: Birthday[];
  today: string;
};

const ABSENCE_LABEL: Record<AbsenceKind, string> = {
  VACATION: "Отпуск",
  SICK: "Больничный",
  OTHER: "Отсутствие",
};

/** «через 3 дня» человеческим языком — в списке ближайших дней рождения. */
function inDaysLabel(inDays: number): string {
  if (inDays === 0) return "сегодня";
  if (inDays === 1) return "завтра";
  if (inDays === 2) return "послезавтра";
  const mod10 = inDays % 10;
  const mod100 = inDays % 100;
  const word = mod10 === 1 && mod100 !== 11 ? "день" : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? "дня" : "дней";
  return `через ${inDays} ${word}`;
}

function periodLabel(a: Absence): string {
  return a.dateFrom === a.dateTo
    ? formatDateShort(a.dateFrom)
    : `${formatDateShort(a.dateFrom)} — ${formatDateShort(a.dateTo)}`;
}

export function TeamClient({ canManage }: { canManage: boolean }) {
  const { data, isLoading, mutate } = useSWR<Snapshot>("/api/team", fetcher);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [addingMember, setAddingMember] = useState(false);
  const [addingAbsence, setAddingAbsence] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const members = data?.members ?? [];
  const birthdays = data?.birthdays ?? [];
  const today = data?.today ?? "";
  // Через useMemo, а не `?? []` по месту: иначе на каждый рендер новый массив и зависимости
  // useMemo ниже меняются впустую.
  const absences = useMemo(() => data?.absences ?? [], [data]);

  // Идёт сейчас / только предстоит — разные вещи для планирования, поэтому показываем раздельно.
  const [current, planned] = useMemo(() => {
    const cur: Absence[] = [];
    const next: Absence[] = [];
    for (const a of absences) (a.dateFrom <= today ? cur : next).push(a);
    return [cur, next];
  }, [absences, today]);

  // Ближайшее отсутствие человека — колонка в таблице: «в отпуске до …» или «отпуск с …».
  const absenceByMember = useMemo(() => {
    const map = new Map<string, Absence>();
    for (const a of absences) if (!map.has(a.driverId)) map.set(a.driverId, a);
    return map;
  }, [absences]);

  async function removeAbsence(a: Absence) {
    if (!confirm(`Убрать «${ABSENCE_LABEL[a.type]}» у ${a.driverName ?? "сотрудника"} (${periodLabel(a)})?`)) return;
    setError(null);
    setBusyId(a.id);
    try {
      await apiSend(`/api/absences/${a.id}`, "DELETE");
      await mutate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось убрать запись");
    } finally {
      setBusyId(null);
    }
  }

  async function removeMember(m: Member) {
    if (!confirm(`Убрать «${m.name}» из справочника? Он пропадёт из списка и из поздравлений.`)) return;
    setError(null);
    setBusyId(m.id);
    try {
      await apiSend(`/api/team/${m.id}`, "DELETE");
      await mutate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось убрать сотрудника");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Команда</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            Дни рождения и отпуска коллег. Напоминание о дне рождения приходит всем за 3 дня и утром в
            сам день.
          </p>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setAddingAbsence(true)} data-testid="add-absence">
              <CalendarPlus className="h-4 w-4" /> Отпуск
            </Button>
            <Button onClick={() => setAddingMember(true)} data-testid="add-member">
              <UserPlus className="h-4 w-4" /> Сотрудник
            </Button>
          </div>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {isLoading && members.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-400">Загрузка…</p>
      ) : (
        <>
          <section className="mt-5">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-700">
              <Cake className="h-4 w-4 text-neutral-400" /> Ближайшие дни рождения
            </h2>
            {birthdays.length === 0 ? (
              <p className="text-sm text-neutral-400">В ближайшие два месяца дней рождения нет.</p>
            ) : (
              <ul className="flex flex-wrap gap-2" data-testid="birthday-list">
                {birthdays.map((b) => (
                  <li
                    key={b.id}
                    className={
                      b.inDays === 0
                        ? "flex items-center gap-2 rounded-lg border border-amber-500 bg-amber-50 px-3 py-2 text-sm"
                        : "flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm"
                    }
                  >
                    <span className="font-medium text-neutral-900">{b.name}</span>
                    <span className="text-neutral-500">{b.label}</span>
                    <Badge
                      className={
                        b.inDays === 0
                          ? "border border-amber-500 text-amber-700"
                          : "border border-neutral-300 text-neutral-600"
                      }
                    >
                      {inDaysLabel(b.inDays)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-neutral-700">Отпуска и отсутствия</h2>
            {absences.length === 0 ? (
              <p className="text-sm text-neutral-400">Никто не в отпуске и ничего не запланировано.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <AbsenceList
                  title="Сейчас отсутствуют"
                  items={current}
                  empty="Все на месте."
                  canManage={canManage}
                  busyId={busyId}
                  onRemove={removeAbsence}
                />
                <AbsenceList
                  title="Запланировано"
                  items={planned}
                  empty="Пока никто не собирается."
                  canManage={canManage}
                  busyId={busyId}
                  onRemove={removeAbsence}
                />
              </div>
            )}
          </section>

          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-neutral-700">Сотрудники</h2>
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-neutral-200 text-xs text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Имя</th>
                    <th className="px-4 py-2 font-medium">Должность</th>
                    <th className="px-4 py-2 font-medium">Телефон</th>
                    <th className="px-4 py-2 font-medium">День рождения</th>
                    <th className="px-4 py-2 font-medium">Отпуск</th>
                    {canManage ? <th className="px-4 py-2 font-medium" /> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100" data-testid="member-rows">
                  {members.map((m) => (
                    <MemberRow
                      key={m.id}
                      member={m}
                      absence={absenceByMember.get(m.id) ?? null}
                      today={today}
                      canManage={canManage}
                      busy={busyId === m.id}
                      onEdit={() => setEditing(m)}
                      onRemove={() => removeMember(m)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {canManage ? (
              <p className="mt-2 text-xs text-neutral-400">
                Имя, должность и телефон сотрудников с доступом в систему меняются в разделе
                «Управление» — здесь им проставляется только день рождения.
              </p>
            ) : null}
          </section>
        </>
      )}

      {addingMember ? (
        <MemberModal
          member={null}
          onClose={() => setAddingMember(false)}
          onSaved={async () => {
            setAddingMember(false);
            await mutate();
          }}
        />
      ) : null}

      {editing ? (
        <MemberModal
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await mutate();
          }}
        />
      ) : null}

      {addingAbsence ? (
        <AbsenceModal
          members={members}
          onClose={() => setAddingAbsence(false)}
          onSaved={async () => {
            setAddingAbsence(false);
            await mutate();
          }}
        />
      ) : null}
    </main>
  );
}

function AbsenceList({
  title,
  items,
  empty,
  canManage,
  busyId,
  onRemove,
}: {
  title: string;
  items: Absence[];
  empty: string;
  canManage: boolean;
  busyId: string | null;
  onRemove: (a: Absence) => void;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <p className="mb-2 text-xs font-medium text-neutral-500">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-neutral-400">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-neutral-700">
                <span className="font-medium text-neutral-900">{a.driverName}</span> · {ABSENCE_LABEL[a.type]} ·{" "}
                {periodLabel(a)}
                {a.note ? ` · ${a.note}` : ""}
              </span>
              {canManage ? (
                <Button
                  variant="ghost"
                  className="h-8 shrink-0 px-2 text-xs"
                  disabled={busyId === a.id}
                  onClick={() => onRemove(a)}
                >
                  Убрать
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MemberRow({
  member,
  absence,
  today,
  canManage,
  busy,
  onEdit,
  onRemove,
}: {
  member: Member;
  absence: Absence | null;
  today: string;
  canManage: boolean;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const phones = member.phone ? parsePhones(member.phone) : [];
  const absenceText = absence
    ? absence.dateFrom <= today
      ? `${ABSENCE_LABEL[absence.type]} до ${formatDateShort(absence.dateTo)}`
      : `${ABSENCE_LABEL[absence.type]} с ${formatDateShort(absence.dateFrom)}`
    : null;

  return (
    <tr className="text-neutral-700">
      <td className="px-4 py-2">
        <span className="font-medium text-neutral-900">{member.name}</span>
        {member.role === "EMPLOYEE" ? (
          <Badge className="ml-2 border border-neutral-300 text-neutral-500">без входа</Badge>
        ) : null}
      </td>
      <td className="px-4 py-2 text-neutral-600">{member.position?.trim() || roleLabel(member.role)}</td>
      <td className="px-4 py-2">
        {phones.length > 0 ? (
          <a href={phones[0].href} className="text-neutral-700 hover:underline">
            {phones[0].display}
          </a>
        ) : (
          <span className="text-neutral-300">—</span>
        )}
      </td>
      <td className="px-4 py-2">
        {member.birthday ? (
          <span className="text-neutral-700">{formatBirthday(member.birthday)}</span>
        ) : (
          <span className="text-neutral-300">не указан</span>
        )}
      </td>
      <td className="px-4 py-2 text-neutral-600">{absenceText ?? <span className="text-neutral-300">—</span>}</td>
      {canManage ? (
        <td className="px-4 py-2">
          <div className="flex justify-end gap-1">
            <Button variant="ghost" className="h-8 px-2 text-xs" disabled={busy} onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" /> Изменить
            </Button>
            {member.editable ? (
              <Button variant="ghost" className="h-8 px-2 text-xs" disabled={busy} onClick={onRemove}>
                Убрать
              </Button>
            ) : null}
          </div>
        </td>
      ) : null}
    </tr>
  );
}

// Дата рождения в списке — без года (возраст коллеги никого не касается, решение Артёма).
const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function formatBirthday(iso: string): string {
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  if (!month || !day) return "";
  return `${day} ${MONTHS_GENITIVE[month - 1]}`;
}

// Карточка сотрудника. У заведённых здесь (без входа) правим всё, у учёток с доступом — только
// день рождения: имя, должность и телефон там ведёт «Управление», и подменять его отсюда нельзя.
function MemberModal({
  member,
  onClose,
  onSaved,
}: {
  member: Member | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = member === null;
  const fullEdit = isNew || member.editable;
  const [name, setName] = useState(member?.name ?? "");
  const [position, setPosition] = useState(member?.position ?? "");
  const [phone, setPhone] = useState(member?.phone ?? "");
  const [birthday, setBirthday] = useState(member?.birthday ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (fullEdit && !name.trim()) {
      setError("Укажите имя сотрудника");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (isNew) {
        await apiSend("/api/team", "POST", {
          name,
          position: position.trim(),
          phone: phone.trim(),
          birthday,
        });
      } else if (fullEdit) {
        await apiSend(`/api/team/${member.id}`, "PATCH", {
          name,
          position: position.trim(),
          phone: phone.trim(),
          birthday,
        });
      } else {
        await apiSend(`/api/team/${member.id}`, "PATCH", { birthday });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить");
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? "Новый сотрудник" : member.name}>
      <div className="flex flex-col gap-3">
        {fullEdit ? (
          <>
            <Field label="Имя" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus data-testid="member-name" />
            </Field>
            <Field label="Должность" hint="Например: сварщик, мастер цеха">
              <Input value={position} onChange={(e) => setPosition(e.target.value)} />
            </Field>
            <Field label="Телефон">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </>
        ) : (
          <p className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-500">
            У сотрудника есть доступ в систему: имя, должность и телефон меняются в разделе
            «Управление». Здесь — только день рождения.
          </p>
        )}
        <Field label="День рождения" hint="Можно ввести «21.08.1985» или просто «21.08», если год не важен">
          <DateField value={birthday} onChange={setBirthday} testId="member-birthday" />
        </Field>
        {isNew ? (
          <p className="text-xs text-neutral-400">
            Сотрудник появится в справочнике и в поздравлениях. Доступа в систему у него не будет.
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={save} disabled={busy} data-testid="member-save">
            Сохранить
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Отпуск/больничный любому сотруднику (с 18.08.2026 — не только водителю).
function AbsenceModal({
  members,
  onClose,
  onSaved,
}: {
  members: Member[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [driverId, setDriverId] = useState("");
  const [type, setType] = useState<AbsenceKind>("VACATION");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectCls =
    "h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm outline-none focus:border-neutral-900";

  async function save() {
    if (!driverId || !from || !to) {
      setError("Выберите сотрудника и период");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await apiSend("/api/absences", "POST", {
        driverId,
        dateFrom: from,
        dateTo: to,
        type,
        note: note.trim() || undefined,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить");
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Отпуск или отсутствие">
      <div className="flex flex-col gap-3">
        <Field label="Сотрудник" required>
          <select
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            className={selectCls}
            data-testid="absence-member"
          >
            <option value="">— выберите —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Причина">
          <select value={type} onChange={(e) => setType(e.target.value as AbsenceKind)} className={selectCls}>
            <option value="VACATION">Отпуск</option>
            <option value="SICK">Больничный</option>
            <option value="OTHER">Отсутствие</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="С">
            <DateField value={from} onChange={setFrom} testId="absence-from" />
          </Field>
          <Field label="По">
            <DateField value={to} onChange={setTo} testId="absence-to" />
          </Field>
        </div>
        <Field label="Комментарий">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="По желанию" />
        </Field>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={save} disabled={busy} data-testid="absence-save">
            Сохранить
          </Button>
        </div>
      </div>
    </Modal>
  );
}
