"use client";

import { useState } from "react";
import { apiSend } from "@/lib/fetcher";
import type { DriverDTO, TaskDTO, TaskTypeDTO } from "@/lib/task-dto";
import type { PassStatus, PaymentType } from "@/generated/prisma/enums";
import { PASS_LABEL, PAYMENT_LABEL } from "@/lib/task-ui";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";

type FormState = {
  typeId: string;
  title: string;
  address: string;
  description: string;
  equipment: string;
  orgName: string;
  contactName: string;
  contactPhone: string;
  addressLink: string;
  invoiceNumber: string;
  paymentType: PaymentType;
  paymentAmount: string;
  paymentNote: string;
  scheduledDate: string;
  timeFrom: string;
  timeTo: string;
  timeNote: string;
  passStatus: PassStatus;
  priority: boolean;
  assigneeId: string;
  requiresAct: boolean; // требование акта (дефолт из типа, диспетчер может снять)
  actWaivedNote: string; // причина снятия требования акта
};

function emptyForm(typeId: string, date: string, requiresAct: boolean): FormState {
  return {
    typeId,
    title: "",
    address: "",
    description: "",
    equipment: "",
    orgName: "",
    contactName: "",
    contactPhone: "",
    addressLink: "",
    invoiceNumber: "",
    paymentType: "NONE",
    paymentAmount: "",
    paymentNote: "",
    scheduledDate: date,
    timeFrom: "",
    timeTo: "",
    timeNote: "",
    passStatus: "NOT_NEEDED",
    priority: false,
    assigneeId: "",
    requiresAct,
    actWaivedNote: "",
  };
}

function formFromTask(t: TaskDTO): FormState {
  return {
    typeId: t.type.id,
    title: t.title,
    address: t.address,
    description: t.description ?? "",
    equipment: t.equipment ?? "",
    orgName: t.orgName ?? "",
    contactName: t.contactName ?? "",
    contactPhone: t.contactPhone ?? "",
    addressLink: t.addressLink ?? "",
    invoiceNumber: t.invoiceNumber ?? "",
    paymentType: t.paymentType,
    paymentAmount: t.paymentAmount === null ? "" : String(t.paymentAmount),
    paymentNote: t.paymentNote ?? "",
    scheduledDate: t.scheduledDate ? t.scheduledDate.slice(0, 10) : "",
    timeFrom: t.timeFrom ?? "",
    timeTo: t.timeTo ?? "",
    timeNote: t.timeNote ?? "",
    passStatus: t.passStatus,
    priority: t.priority,
    assigneeId: t.assigneeId ?? "",
    requiresAct: t.requiresSignedDoc,
    actWaivedNote: t.actWaivedNote ?? "",
  };
}

export function CreateTaskModal({
  open,
  onClose,
  types,
  drivers,
  onCreated,
  defaultDate = "",
  editTask = null,
}: {
  open: boolean;
  onClose: () => void;
  types: TaskTypeDTO[];
  drivers: DriverDTO[];
  onCreated: () => void;
  defaultDate?: string;
  editTask?: TaskDTO | null;
}) {
  const isEdit = editTask !== null;
  // Редактирование завершённой/отменённой заявки: дату менять нельзя (решение Артёма 02.07.2026) —
  // перенос закрытой заявки запрещён на сервере, поэтому поле «Дата» в этом режиме скрываем.
  const isTerminalEdit = editTask?.status === "DONE" || editTask?.status === "CANCELLED";
  const firstType = types[0]?.id ?? "";
  const [form, setForm] = useState<FormState>(() =>
    editTask ? formFromTask(editTask) : emptyForm(firstType, defaultDate, types[0]?.requiresSignedDoc ?? false),
  );
  const [showAll, setShowAll] = useState(isEdit);
  const [noDate, setNoDate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Тип задаёт дефолт требования акта; смена типа обновляет галочку (PRD §3–§4).
  const selectedType = types.find((x) => x.id === form.typeId) ?? null;
  const typeNeedsAct = selectedType?.requiresSignedDoc ?? false;
  function onTypeChange(id: string) {
    const tt = types.find((x) => x.id === id);
    setForm((f) => ({ ...f, typeId: id, requiresAct: tt?.requiresSignedDoc ?? false, actWaivedNote: "" }));
  }

  function buildBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      typeId: form.typeId,
      title: form.title,
      address: form.address,
      paymentType: form.paymentType,
      passStatus: form.passStatus,
      priority: form.priority,
    };
    const optional: Record<string, string> = {
      description: form.description,
      equipment: form.equipment,
      orgName: form.orgName,
      contactName: form.contactName,
      contactPhone: form.contactPhone,
      addressLink: form.addressLink,
      invoiceNumber: form.invoiceNumber,
      paymentNote: form.paymentNote,
      timeFrom: form.timeFrom,
      timeTo: form.timeTo,
      timeNote: form.timeNote,
    };
    // В режиме редактирования отправляем и пустые (как очистку через null); при создании — только заполненные.
    for (const [k, v] of Object.entries(optional)) {
      if (v.trim()) body[k] = v.trim();
      else if (isEdit) body[k] = null;
    }
    body.scheduledDate = form.scheduledDate ? form.scheduledDate : isEdit ? null : undefined;
    body.paymentAmount = form.paymentAmount.trim()
      ? Number.parseInt(form.paymentAmount, 10)
      : isEdit
        ? null
        : undefined;
    if (!isEdit && form.assigneeId) body.assigneeId = form.assigneeId;
    body.requiresAct = form.requiresAct;
    if (!form.requiresAct && form.actWaivedNote.trim()) body.actWaivedNote = form.actWaivedNote.trim();
    else if (isEdit) body.actWaivedNote = null;
    return body;
  }

  async function submit(again: boolean) {
    setError(null);
    setBusy(true);
    try {
      const body = buildBody();
      if (isEdit && editTask) {
        await apiSend(`/api/tasks/${editTask.id}`, "PATCH", { op: "edit", ...body });
      } else {
        await apiSend("/api/tasks", "POST", body);
      }
      onCreated();
      if (again && !isEdit) {
        setForm(emptyForm(form.typeId, form.scheduledDate, selectedType?.requiresSignedDoc ?? false));
        setShowAll(false);
      } else {
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Редактировать задачу" : "Новая задача"} wide>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <Field label="Тип" required>
          <Select
            data-testid="create-type"
            value={form.typeId}
            onChange={(e) => onTypeChange(e.target.value)}
            required
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Название / суть" required>
          <Input
            autoFocus
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="ЛБМ 200 + нож, 0,7 мм"
            required
          />
        </Field>

        <Field label="Адрес" required>
          <Input
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
            placeholder="Москва, ул. ..., д. ..."
            required
          />
        </Field>

        {/* Обязательные при создании (решение Артёма 02.07.2026): организация, контактное лицо,
            телефон — вверху формы. При редактировании не блокируем (старые заявки могут быть без них). */}
        <Field label="Организация" required={!isEdit}>
          <Input
            data-testid="create-org"
            value={form.orgName}
            onChange={(e) => set("orgName", e.target.value)}
            placeholder="ООО «...»"
            required={!isEdit}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Контактное лицо" required={!isEdit}>
            <Input
              data-testid="create-contact-name"
              value={form.contactName}
              onChange={(e) => set("contactName", e.target.value)}
              placeholder="Имя"
              required={!isEdit}
            />
          </Field>
          <Field label="Телефон" required={!isEdit}>
            <Input
              data-testid="create-contact-phone"
              value={form.contactPhone}
              onChange={(e) => set("contactPhone", e.target.value)}
              placeholder="+7 ..."
              required={!isEdit}
            />
          </Field>
        </div>

        {!isTerminalEdit ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Дата">
            <DateField
              testId="create-date"
              value={form.scheduledDate}
              disabled={noDate}
              onChange={(v) => set("scheduledDate", v)}
            />
            {!isEdit ? (
              <label className="mt-1.5 flex items-center gap-2 text-sm text-neutral-600">
                <input
                  type="checkbox"
                  data-testid="create-no-date"
                  checked={noDate}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setNoDate(on);
                    // Снимаем дату при включении; при выключении возвращаем дефолт (обычно — сегодня).
                    set("scheduledDate", on ? "" : defaultDate);
                  }}
                  className="h-4 w-4"
                />
                Не указывать дату (пул «Без даты»)
              </label>
            ) : null}
          </Field>
          {!isEdit ? (
            <Field label="Исполнитель">
              <Select
                data-testid="create-assignee"
                value={form.assigneeId}
                onChange={(e) => set("assigneeId", e.target.value)}
              >
                <option value="">Не назначено</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
        ) : null}

        <div className="rounded-lg border border-neutral-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
            <input
              type="checkbox"
              data-testid="create-requires-act"
              checked={form.requiresAct}
              onChange={(e) => set("requiresAct", e.target.checked)}
              className="h-4 w-4"
            />
            Нужен подписанный акт
          </label>
          {typeNeedsAct && !form.requiresAct ? (
            <div className="mt-2">
              <Input
                data-testid="create-act-waived-note"
                value={form.actWaivedNote}
                onChange={(e) => set("actWaivedNote", e.target.value)}
                placeholder="Почему без акта (напр. «подпишут по ЭДО»)"
              />
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start text-sm text-neutral-500 underline-offset-2 hover:underline"
        >
          {showAll ? "Скрыть доп. поля" : "Показать все поля"}
        </button>

        {showAll ? (
          <div className="flex flex-col gap-3 border-t border-neutral-100 pt-3">
            <Field label="Оборудование">
              <Input value={form.equipment} onChange={(e) => set("equipment", e.target.value)} />
            </Field>
            <Field label="Ссылка на точку (Яндекс/2ГИС)">
              <Input value={form.addressLink} onChange={(e) => set("addressLink", e.target.value)} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Счёт №">
                <Input value={form.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} />
              </Field>
              <Field label="Окно с">
                <Input value={form.timeFrom} onChange={(e) => set("timeFrom", e.target.value)} placeholder="09:00" />
              </Field>
              <Field label="Окно до">
                <Input value={form.timeTo} onChange={(e) => set("timeTo", e.target.value)} placeholder="17:00" />
              </Field>
            </div>
            <Field label="Комментарий ко времени">
              <Input value={form.timeNote} onChange={(e) => set("timeNote", e.target.value)} placeholder="после обеда" />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Оплата">
                <Select
                  value={form.paymentType}
                  onChange={(e) => set("paymentType", e.target.value as PaymentType)}
                >
                  {Object.entries(PAYMENT_LABEL).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Сумма, ₽">
                <Input
                  type="number"
                  value={form.paymentAmount}
                  onChange={(e) => set("paymentAmount", e.target.value)}
                />
              </Field>
              <Field label="Пропуск">
                <Select
                  data-testid="create-pass"
                  value={form.passStatus}
                  onChange={(e) => set("passStatus", e.target.value as PassStatus)}
                >
                  {Object.entries(PASS_LABEL).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Примечание к оплате">
              <Input value={form.paymentNote} onChange={(e) => set("paymentNote", e.target.value)} />
            </Field>
            <Field label="Описание">
              <Textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={form.priority}
                onChange={(e) => set("priority", e.target.checked)}
                className="h-4 w-4"
              />
              Срочная задача
            </label>
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Сохранение…" : isEdit ? "Сохранить" : "Создать"}
          </Button>
          {!isEdit ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void submit(true)}>
              Создать и ещё одну
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </form>
    </Modal>
  );
}
