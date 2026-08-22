"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { apiSend } from "@/lib/fetcher";
import type { DriverDTO, TaskDTO, TaskTypeDTO } from "@/lib/task-dto";
import type { PassStatus, PaymentType, TaskMachineDirection } from "@/generated/prisma/enums";
import { emptyForm, formFromTask, isDirtyForm, type FormState } from "@/lib/task-draft";
import {
  TASK_MACHINE_DIRECTION_LABEL,
  isBidirectionalFlow,
  normalizeDirection,
  presetDirection,
} from "@/domain/task-machine-flow";
import { MachineLinkPicker, type PickedMachine } from "./machine-link-picker";
import { cn } from "@/lib/cn";
import { PASS_LABEL, PAYMENT_LABEL } from "@/lib/task-ui";
import { parsePhones } from "@/lib/phone";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { TimeField } from "@/components/ui/time-field";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";

export function CreateTaskModal({
  open,
  onClose,
  types,
  drivers,
  onCreated,
  defaultDate = "",
  editTask = null,
  initialForm = null,
  copyOf = null,
  onMinimize,
  onDiscard,
}: {
  open: boolean;
  onClose: () => void;
  types: TaskTypeDTO[];
  drivers: DriverDTO[];
  /** Заявка создана/сохранена. В режиме создания приходит созданная задача — карточка уходит на неё. */
  onCreated: (created?: TaskDTO) => void;
  defaultDate?: string;
  editTask?: TaskDTO | null;
  /**
   * Копия заявки (22.08.2026): форма приходит готовой в initialForm, а здесь — только подписи.
   * Копия — обычное создание: тот же POST, тот же черновик при случайном закрытии.
   */
  copyOf?: { label: string; hint: string } | null;
  // Черновик (доработка №1, только режим создания): восстановленное состояние формы и колбэки —
  // onMinimize (свернуть непустую форму в черновик при случайном закрытии) и onDiscard (снять черновик
  // при осознанном отказе/успешной отправке). В режиме редактирования не используются.
  initialForm?: FormState | null;
  onMinimize?: (form: FormState) => void;
  onDiscard?: () => void;
}) {
  const isEdit = editTask !== null;
  // Редактирование завершённой/отменённой заявки: дату менять нельзя (решение Артёма 02.07.2026) —
  // перенос закрытой заявки запрещён на сервере, поэтому поле «Дата» в этом режиме скрываем.
  const isTerminalEdit = editTask?.status === "DONE" || editTask?.status === "CANCELLED";
  const firstType = types[0]?.id ?? "";
  const [form, setForm] = useState<FormState>(() =>
    editTask
      ? formFromTask(editTask)
      : initialForm
        ? // Старый черновик localStorage (до 20.07 — без coDriverId, до 21.08 — без machines):
          // читаем с дефолтами, версию ключа не поднимаем, чтобы не выбросить живые черновики.
          { ...initialForm, coDriverId: initialForm.coDriverId ?? "", machines: initialForm.machines ?? [] }
        : emptyForm(firstType, defaultDate, types[0]?.requiresSignedDoc ?? false),
  );
  // У копии раскрываем все поля сразу: смысл копии — проверить унаследованное, а не догадываться,
  // что спряталось под «Показать все поля».
  const [showAll, setShowAll] = useState(isEdit || copyOf !== null);
  const [noDate, setNoDate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Тип задаёт дефолт требования акта; смена типа обновляет галочку (PRD §3–§4).
  const selectedType = types.find((x) => x.id === form.typeId) ?? null;
  // Стоимость поездки — только при внешнем исполнителе (этап 3, 02.07). В режиме редактирования
  // селекта исполнителя нет, но form.assigneeId заполнен из задачи — признак работает и там.
  const assigneeIsExternal = drivers.some((d) => d.id === form.assigneeId && d.isExternal);
  // Сколько номеров распознано в поле «Телефон» — подсказка Милене (03.08).
  const phoneCount = parsePhones(form.contactPhone).length;
  const typeNeedsAct = selectedType?.requiresSignedDoc ?? false;
  // Автоматика по станку (21.08.2026). Старые клиенты поля не знают — читаем с дефолтом «ничего».
  const machineFlow = selectedType?.machineFlow ?? "NONE";
  // Сегмент направления показываем только там, где тип действительно двунаправленный: у «Доставки
  // проданного» он был бы выбором из одного варианта, а у «Прочего» — вопросом ни о чём.
  const showDirection = isBidirectionalFlow(machineFlow);

  function onTypeChange(id: string) {
    const tt = types.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      typeId: id,
      requiresAct: tt?.requiresSignedDoc ?? false,
      actWaivedNote: "",
      // Смена типа может сделать направление жёстким (продажа — всегда «везём»). Выбранные станки
      // остаются, направления нормализуются по новому типу — тем же правилом, что и на сервере.
      machines: f.machines.map((m) => ({
        ...m,
        direction: normalizeDirection(tt?.machineFlow ?? "NONE", m.direction),
      })),
    }));
  }

  function toggleMachine(picked: PickedMachine) {
    setForm((f) => {
      const existing = f.machines.find((m) => m.machineId === picked.machineId);
      if (existing) {
        return { ...f, machines: f.machines.filter((m) => m.machineId !== picked.machineId) };
      }
      // Направление предлагаем по состоянию станка (стоит у клиента — значит забираем), а жёсткое
      // правило типа его перекрывает. Человек всегда может перещёлкнуть сегмент.
      const direction = normalizeDirection(machineFlow, presetDirection(picked.status));
      return {
        ...f,
        machines: [...f.machines, { machineId: picked.machineId, label: picked.label, direction }],
      };
    });
  }

  function removeMachine(machineId: string) {
    setForm((f) => ({ ...f, machines: f.machines.filter((m) => m.machineId !== machineId) }));
  }

  function setMachineDirection(machineId: string, direction: TaskMachineDirection) {
    setForm((f) => ({
      ...f,
      machines: f.machines.map((m) => (m.machineId === machineId ? { ...m, direction } : m)),
    }));
  }

  // Тумблер «Взять деньги на точке» ↔ paymentType=ON_SITE (решение Артёма 17.07: поле оплаты должно
  // быть на виду, а не под «Показать все поля»). Источник истины один — form.paymentType, тумблер и
  // селект в доп.полях биндятся на него, рассинхрон невозможен. Выключение тумблера возвращает
  // предыдущее не-ON_SITE значение, чтобы случайный клик не стирал выбранное «Через офис».
  const prevPaymentRef = useRef<PaymentType>(form.paymentType === "ON_SITE" ? "NONE" : form.paymentType);
  const onSiteMoney = form.paymentType === "ON_SITE";
  function toggleOnSite(on: boolean) {
    if (on) {
      if (form.paymentType !== "ON_SITE") prevPaymentRef.current = form.paymentType;
      set("paymentType", "ON_SITE");
    } else {
      set("paymentType", prevPaymentRef.current);
    }
  }
  function onPaymentSelect(v: PaymentType) {
    if (v !== "ON_SITE") prevPaymentRef.current = v;
    set("paymentType", v);
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
    // Напарник (20.07): при создании шлём только выбранного; при правке открытой задачи пустое
    // значение = снять напарника (null). Закрытые задачи пару не меняют (поле скрыто, сервер игнорирует).
    if (!isEdit) {
      if (form.assigneeId && form.coDriverId) body.coDriverId = form.coDriverId;
    } else if (!isTerminalEdit) {
      body.coDriverId = form.assigneeId && form.coDriverId ? form.coDriverId : null;
    }
    body.requiresAct = form.requiresAct;
    if (!form.requiresAct && form.actWaivedNote.trim()) body.actWaivedNote = form.actWaivedNote.trim();
    else if (isEdit) body.actWaivedNote = null;
    // Стоимость поездки шлём только при внешнем исполнителе (пустое поле при правке = очистка).
    if (assigneeIsExternal) {
      body.carrierCost = form.carrierCost.trim()
        ? Number.parseInt(form.carrierCost, 10)
        : isEdit
          ? null
          : undefined;
    }
    // Станки — ВСЕГДА полным набором (семантика «полный набор атомарно», как категории станка):
    // при правке пустой массив осознанно снимает все привязки. При создании пустой набор слать не
    // за чем, но и вреда нет — сервер получит «связей нет» и ничего не создаст.
    body.machines = form.machines.map((m) => ({ machineId: m.machineId, direction: m.direction }));
    return body;
  }

  async function submit(again: boolean) {
    setError(null);
    setBusy(true);
    try {
      const body = buildBody();
      if (isEdit && editTask) {
        await apiSend(`/api/tasks/${editTask.id}`, "PATCH", { op: "edit", ...body });
        onCreated();
      } else {
        const created = await apiSend<TaskDTO>("/api/tasks", "POST", body);
        // «Создать и ещё одну» оставляет диспетчера в форме — созданную задачу наверх не отдаём,
        // иначе карточка увела бы его на новую заявку прямо посреди ввода следующей.
        onCreated(again ? undefined : created);
      }
      onDiscard?.(); // заявка создана — связанный черновик больше не нужен
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

  // Закрытие «мимо» (клик по фону / Escape / крестик — все три идут через onClose модалки). В режиме
  // создания непустую форму сворачиваем в черновик (ввод не теряется), пустую — просто закрываем.
  // В режиме редактирования черновиков нет — просто закрываем.
  function handleMinimize() {
    if (!isEdit) {
      if (isDirtyForm(form)) onMinimize?.(form);
      else onDiscard?.(); // всё стёрли в восстановленном черновике — убрать его
    }
    onClose();
  }

  // Кнопка «Отмена» — осознанный отказ. Есть ввод → переспрашиваем; черновик при этом НЕ сохраняем
  // (решение Артёма 03.07: сохраняем только при СЛУЧАЙНОМ закрытии).
  function handleCancel() {
    if (!isEdit && isDirtyForm(form) && !window.confirm("Выбросить заявку? Введённые данные не сохранятся.")) {
      return;
    }
    onDiscard?.();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleMinimize}
      title={copyOf ? copyOf.label : isEdit ? "Редактировать задачу" : "Новая задача"}
      wide
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        {/* Подсказка копии — янтарём: «требует действия сейчас» (ui-guidelines). Дату и исполнителя
            копия не наследует, а оплату наследует — и то, и другое надо проверить глазами. */}
        {copyOf ? (
          <p
            data-testid="copy-hint"
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          >
            {copyOf.hint}
          </p>
        ) : null}
        {/* Секции формы (дизайн 24.07.2026, вариант B): поля сгруппированы по смыслу —
            суть → клиент → когда и кто → оплата и документы → дополнительно. */}
        <FormSection title="Суть заявки">
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
        </FormSection>

        {/* Станки из картотеки (21.08.2026, PRD §16.1): «везём станок на продажу → подцепляем к
            заявке». Поле необязательное на любом типе — свободный текст «Оборудование» остаётся
            для мелочёвки. У типов с автоматикой при завершении система сама переведёт карточку. */}
        <FormSection title="Станки · по желанию">
          {form.machines.length > 0 ? (
            <ul className="flex flex-col gap-2" data-testid="task-machines">
              {form.machines.map((m) => (
                <li
                  key={m.machineId}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 px-2.5 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">
                    {m.label}
                  </span>
                  {showDirection ? (
                    <span className="flex gap-1" role="group" aria-label="Направление">
                      {(["OUT", "IN"] as TaskMachineDirection[]).map((d) => (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={m.direction === d}
                          onClick={() => setMachineDirection(m.machineId, d)}
                          data-testid={`machine-direction-${d}`}
                          className={cn(
                            "min-h-9 rounded-lg border px-2.5 text-xs font-medium transition-colors",
                            m.direction === d
                              ? "border-neutral-900 bg-neutral-900 text-white"
                              : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400",
                          )}
                        >
                          {TASK_MACHINE_DIRECTION_LABEL[d]}
                        </button>
                      ))}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeMachine(m.machineId)}
                    aria-label={`Убрать ${m.label}`}
                    className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setPickerOpen(true)}
            className="self-start"
            data-testid="task-pick-machine"
          >
            <Plus className="h-4 w-4" /> Выбрать станок из картотеки
          </Button>
        </FormSection>

        {/* Организация, контактное лицо, телефон — НЕобязательны (решение Артёма 24.07.2026: быстрая
            постановка заявки). Обязательны только Тип, Название, Адрес. */}
        <FormSection title="Клиент · по желанию">
          <Field label="Организация">
            <Input
              data-testid="create-org"
              value={form.orgName}
              onChange={(e) => set("orgName", e.target.value)}
              placeholder="ООО «...»"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Контактное лицо">
              <Input
                data-testid="create-contact-name"
                value={form.contactName}
                onChange={(e) => set("contactName", e.target.value)}
                placeholder="Имя"
              />
            </Field>
            <Field label="Телефон">
              <Input
                data-testid="create-contact-phone"
                type="tel"
                inputMode="tel"
                value={form.contactPhone}
                onChange={(e) => set("contactPhone", e.target.value)}
                placeholder="+7 ... (несколько — через запятую)"
              />
              {/* Живой счётчик: Милена сразу видит, что система распознала все номера — у водителя
                  каждый из них будет отдельной кнопкой звонка (03.08). */}
              {phoneCount > 1 ? (
                <p data-testid="create-phone-count" className="mt-1 text-xs text-neutral-500">
                  Распознано номеров: {phoneCount} — водитель увидит их отдельными строками
                </p>
              ) : null}
            </Field>
          </div>
        </FormSection>

        {!isTerminalEdit ? (
          <FormSection title="Когда и кто">
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
                    onChange={(e) => {
                      const v = e.target.value;
                      // Смена/снятие ответственного чинит пару: напарник не может совпасть или остаться без ведущего.
                      setForm((f) => ({
                        ...f,
                        assigneeId: v,
                        coDriverId: !v || f.coDriverId === v ? "" : f.coDriverId,
                      }));
                    }}
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
              {form.assigneeId && (!isEdit || !isTerminalEdit) ? (
                <Field label="Напарник (не обязательно)">
                  <Select
                    data-testid="create-co-driver"
                    value={form.coDriverId}
                    onChange={(e) => set("coDriverId", e.target.value)}
                  >
                    <option value="">— нет —</option>
                    {drivers
                      .filter((d) => d.id !== form.assigneeId)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </Select>
                </Field>
              ) : null}
            </div>
          </FormSection>
        ) : null}

        {/* Деньги на точке — всегда на виду (решение Артёма 17.07 по заявке №657: раньше поля оплаты
            прятались под «Показать все поля», и водитель узнавал о деньгах только на словах). */}
        <FormSection title="Оплата и документы">
          {assigneeIsExternal ? (
            <Field label="Стоимость поездки, ₽ (внешний перевозчик)">
              <Input
                data-testid="create-carrier-cost"
                type="number"
                inputMode="numeric"
                min={0}
                value={form.carrierCost}
                onChange={(e) => set("carrierCost", e.target.value)}
                placeholder="Сколько платим за эту поездку"
              />
              <p className="mt-1 text-xs text-neutral-500">Затраты компании — водителям не видна.</p>
            </Field>
          ) : null}
          <div>
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
          <div className="border-t border-neutral-100 pt-3">
            <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
              <input
                type="checkbox"
                data-testid="create-onsite-toggle"
                checked={onSiteMoney}
                onChange={(e) => toggleOnSite(e.target.checked)}
                className="h-4 w-4"
              />
              Взять деньги на точке
            </label>
            {onSiteMoney ? (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <Field label="Сумма, ₽">
                  <Input
                    data-testid="create-onsite-amount"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={form.paymentAmount}
                    onChange={(e) => set("paymentAmount", e.target.value)}
                  />
                </Field>
                <Field label="Примечание">
                  <Input
                    data-testid="create-onsite-note"
                    value={form.paymentNote}
                    onChange={(e) => set("paymentNote", e.target.value)}
                    placeholder="наличными при выгрузке"
                  />
                </Field>
              </div>
            ) : null}
          </div>
        </FormSection>

        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start text-sm text-neutral-500 underline-offset-2 hover:underline"
        >
          {showAll ? "▾ Скрыть дополнительные поля" : "▸ Дополнительно (оборудование, окно времени, пропуск…)"}
        </button>

        {showAll ? (
          <FormSection title="Дополнительно">
            <Field label="Оборудование">
              <Input value={form.equipment} onChange={(e) => set("equipment", e.target.value)} />
            </Field>
            <Field label="Ссылка на точку (Яндекс/2ГИС)">
              <Input value={form.addressLink} onChange={(e) => set("addressLink", e.target.value)} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Счёт №">
                <Input
                  data-testid="create-invoice"
                  value={form.invoiceNumber}
                  onChange={(e) => set("invoiceNumber", e.target.value)}
                />
              </Field>
              {/* Окно времени — тот же умный ввод, что и в сменах (11.08.2026): «9» → 09:00,
                  «1730» → 17:30. Раньше это были свободные текстовые поля без разбора, и в заявку
                  могло уехать что угодно. Свободная формулировка живёт в «Комментарии ко времени». */}
              <Field label="Окно с">
                <TimeField value={form.timeFrom} onChange={(v) => set("timeFrom", v)} className="w-full" />
              </Field>
              <Field label="Окно до">
                <TimeField value={form.timeTo} onChange={(v) => set("timeTo", v)} className="w-full" />
              </Field>
            </div>
            <Field label="Комментарий ко времени">
              <Input value={form.timeNote} onChange={(e) => set("timeNote", e.target.value)} placeholder="после обеда" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Оплата">
                <Select
                  value={form.paymentType}
                  onChange={(e) => onPaymentSelect(e.target.value as PaymentType)}
                >
                  {Object.entries(PAYMENT_LABEL).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </Select>
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
            {/* Сумма и примечание при «на месте» живут в блоке-тумблере выше; здесь — только для
                «через офис» («доставка 5000, оплатят по счёту»). При «без оплаты» не нужны нигде. */}
            {form.paymentType === "OFFICE" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Сумма, ₽">
                  <Input
                    type="number"
                    value={form.paymentAmount}
                    onChange={(e) => set("paymentAmount", e.target.value)}
                  />
                </Field>
                <Field label="Примечание к оплате">
                  <Input value={form.paymentNote} onChange={(e) => set("paymentNote", e.target.value)} />
                </Field>
              </div>
            ) : null}
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
          </FormSection>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="mt-1 flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Сохранение…" : isEdit ? "Сохранить" : "Создать"}
          </Button>
          {!isEdit ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void submit(true)}>
              Создать и ещё одну
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={handleCancel}>
            Отмена
          </Button>
        </div>
      </form>

      {/* Пикер — второй этаж цепочки модалок: форма заявки остаётся заполненной под ним. */}
      <MachineLinkPicker
        open={pickerOpen}
        selectedIds={form.machines.map((m) => m.machineId)}
        onClose={() => setPickerOpen(false)}
        onToggle={toggleMachine}
      />
    </Modal>
  );
}

// Секция формы (дизайн 24.07.2026, вариант B): рамка + подпись-эйрбрау. Единый вид всех групп полей.
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 p-3.5">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
