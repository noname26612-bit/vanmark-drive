"use client";

import { useState } from "react";
import { apiSend, ApiError } from "@/lib/fetcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { DateField } from "@/components/ui/date-field";
import { TimeField } from "@/components/ui/time-field";
import type { TaskDTO } from "@/lib/task-dto";

export type Performer = { id: string; name: string };

/**
 * Форма задачи сотруднику — постановка и правка (16.08.2026). Полей ровно столько, сколько нужно:
 * что сделать, кому, когда — классификации у этих задач нет (решение Артёма 15.08.2026).
 * Напарник — как в заявке водителям: двое собирают станок так же, как двое едут на выезд.
 *
 * Отдельная форма, а не форма заявки: у задачи цеха нет ни типа, ни адреса, ни денег, ни акта, и
 * показывать их диспетчеру — значит предлагать заполнить то, чего у контура не существует
 * (до 16.08.2026 карточка цеха открывала на правку именно форму доставки).
 */
export function StaffTaskModal({
  performers,
  today,
  editTask = null,
  onClose,
  onSaved,
}: {
  performers: Performer[];
  today: string;
  editTask?: TaskDTO | null; // null — постановка новой задачи
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = editTask !== null;
  // Завершённую/отменённую правим без даты и без пары — ровно как заявку (сервер это и не примет).
  const isTerminal = editTask?.status === "DONE" || editTask?.status === "CANCELLED";

  const [title, setTitle] = useState(editTask?.title ?? "");
  const [description, setDescription] = useState(editTask?.description ?? "");
  const [assigneeId, setAssigneeId] = useState(editTask?.assignee?.id ?? "");
  const [coDriverId, setCoDriverId] = useState(editTask?.coDriverId ?? "");
  const [scheduledDate, setScheduledDate] = useState(
    editTask ? (editTask.scheduledDate?.slice(0, 10) ?? "") : today,
  );
  const [timeFrom, setTimeFrom] = useState(editTask?.timeFrom ?? "");
  const [priority, setPriority] = useState(editTask?.priority ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(keepOpen: boolean) {
    if (!title.trim()) {
      setError("Напишите, что нужно сделать");
      return;
    }
    setSaving(true);
    setError(null);
    const common = {
      title: title.trim(),
      description: description.trim() || null,
      timeFrom: timeFrom || null,
      priority,
    };
    try {
      if (isEdit && editTask) {
        await apiSend(`/api/tasks/${editTask.id}`, "PATCH", {
          op: "edit",
          ...common,
          // Дату завершённой задачи сервер не двигает; пару у неё тоже не трогаем.
          ...(isTerminal ? {} : { scheduledDate: scheduledDate || null }),
          ...(isTerminal
            ? {}
            : { coDriverId: assigneeId && coDriverId ? coDriverId : null }),
        });
      } else {
        await apiSend("/api/tasks", "POST", {
          kind: "STAFF",
          ...common,
          assigneeId: assigneeId || null,
          // Пара без ответственного невозможна (домен это и не примет) — не шлём вовсе.
          ...(assigneeId && coDriverId ? { coDriverId } : {}),
          scheduledDate: scheduledDate || null,
        });
      }
      onSaved();
      if (keepOpen) {
        setTitle("");
        setDescription("");
        setTimeFrom("");
        setPriority(false);
      } else {
        onClose();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить задачу");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? "Правка задачи цеха" : "Задача сотруднику"}>
      <div className="flex flex-col gap-3">
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <Field label="Что сделать" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: забрать ролики с Ленинградки"
            autoFocus
            data-testid="staff-title"
          />
        </Field>

        <Field label="Подробности">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            data-testid="staff-description"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Исполнителя в правке меняют в самой карточке (как у заявок) — здесь только при постановке. */}
          {!isEdit ? (
            <Field label="Кому">
              <Select
                value={assigneeId}
                onChange={(e) => {
                  const v = e.target.value;
                  setAssigneeId(v);
                  // Смена/снятие ответственного чинит пару: напарник не может совпасть с ним или
                  // остаться без ведущего.
                  if (!v || v === coDriverId) setCoDriverId("");
                }}
                data-testid="staff-assignee"
              >
                <option value="">— не назначено —</option>
                {performers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {!isTerminal ? (
            <Field label="Когда">
              <DateField value={scheduledDate} onChange={setScheduledDate} testId="staff-date" />
            </Field>
          ) : null}
        </div>

        {assigneeId && !isTerminal ? (
          <Field label="Напарник (не обязательно)">
            <Select
              value={coDriverId}
              onChange={(e) => setCoDriverId(e.target.value)}
              data-testid="staff-co-driver"
            >
              <option value="">— нет —</option>
              {performers
                .filter((p) => p.id !== assigneeId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ко скольки">
            <TimeField value={timeFrom} onChange={setTimeFrom} testId="staff-time" />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={priority}
              onChange={(e) => setPriority(e.target.checked)}
              className="h-4 w-4"
              data-testid="staff-priority"
            />
            Срочно
          </label>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          {!isEdit ? (
            <Button variant="secondary" onClick={() => void submit(true)} disabled={saving}>
              Создать и ещё
            </Button>
          ) : null}
          <Button onClick={() => void submit(false)} disabled={saving} data-testid="staff-save">
            {isEdit ? "Сохранить" : "Создать"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
