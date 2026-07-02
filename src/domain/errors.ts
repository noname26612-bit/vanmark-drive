// Доменные ошибки с кодом и HTTP-статусом. Хендлеры мапят их в { error: { code, message } }.
// Коды совпадают с контрактом ARCHITECTURE §7 (FORBIDDEN_TRANSITION, NOT_FOUND, VALIDATION...).
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const Errors = {
  unauthorized: () => new DomainError("UNAUTHORIZED", "Требуется вход", 401),
  notFound: () => new DomainError("NOT_FOUND", "Не найдено", 404),
  forbidden: () => new DomainError("FORBIDDEN", "Недостаточно прав", 403),
  invalidTransition: () =>
    new DomainError("FORBIDDEN_TRANSITION", "Недопустимый переход статуса", 409),
  reasonRequired: () => new DomainError("REASON_REQUIRED", "Нужно указать причину", 422),
  dateRequired: () => new DomainError("DATE_REQUIRED", "Нужна новая дата", 422),
  paymentRequired: () =>
    new DomainError("PAYMENT_REQUIRED", "Отметьте: деньги получены или укажите причину неоплаты", 422),
  actReasonRequired: () =>
    new DomainError("ACT_REASON_REQUIRED", "Приложите акт или укажите причину, почему акта нет", 422),
  activeTaskExists: (taskNumber?: number) =>
    new DomainError(
      "ACTIVE_TASK_EXISTS",
      taskNumber
        ? `Сначала завершите активную задачу №${taskNumber}`
        : "У водителя уже есть задача в работе",
      409,
    ),
  shiftRequired: () =>
    new DomainError("SHIFT_REQUIRED", "Сначала откройте смену", 409),
  uploadInvalid: (message: string) => new DomainError("UPLOAD_INVALID", message, 422),
  validation: (message: string) => new DomainError("VALIDATION", message, 422),
  periodClosed: () =>
    new DomainError("PERIOD_CLOSED", "Месяц закрыт — расчёт зафиксирован и не меняется", 409),
  worksheetLocked: () =>
    new DomainError("WORKSHEET_LOCKED", "Ведомость уже отправлена на расценку", 409),
};
