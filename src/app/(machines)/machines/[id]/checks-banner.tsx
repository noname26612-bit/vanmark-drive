"use client";

// Обязательные отметки станка — диагностика и подтверждение на месте (решение Артёма 20.08.2026).
//
// Раньше это были две кнопки в общем ряду действий, и их не замечали: выглядели как справка, а не
// как то, чего от Максима ждут. Артём попросил вынести их «сверху в теле каждого листогиба, как с
// открытием смены» — отсюда янтарная плашка над карточкой, ровно как незакрытая смена на доске
// диспетчера (ui-guidelines: янтарный = требует действия сейчас).
//
// Отметка делается ОДИН раз — когда станок завели или когда он вернулся из аренды (тогда сервер
// сбрасывает отметки сам, см. machine-service). Поэтому кнопка есть только у того, что не отмечено,
// а отмеченное исчезает из плашки совсем: висящий «выполненный» пункт превращает сигнал в фон.
import { AlertTriangle, MapPin, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ChecksBanner({
  diagnosedAt,
  lastVerifiedAt,
  busy,
  onMark,
}: {
  diagnosedAt: string | null;
  lastVerifiedAt: string | null;
  busy: boolean;
  onMark: (op: "diagnosed" | "verified") => void;
}) {
  const needDiagnosis = diagnosedAt === null;
  const needVerification = lastVerifiedAt === null;
  // Гаснем сами, не дожидаясь условия у родителя: после ответа сервера плашка обязана исчезнуть
  // сразу, иначе человек жмёт «отмечено» второй раз.
  if (!needDiagnosis && !needVerification) return null;

  return (
    <section
      data-testid="machine-checks-banner"
      className="rounded-xl border border-amber-200 bg-amber-50 p-3"
    >
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-amber-800">
        <AlertTriangle className="h-4 w-4" />
        Обязательные отметки
      </h2>
      <p className="mb-2 text-xs text-amber-700">
        Отметьте, когда осмотрите станок на площадке. После возврата из аренды отметки нужны заново.
      </p>
      <div className="flex flex-wrap gap-2">
        {needDiagnosis ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onMark("diagnosed")}
            data-testid="machine-diagnosed"
          >
            <Stethoscope className="h-4 w-4" />
            Диагностика проведена
          </Button>
        ) : null}
        {needVerification ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onMark("verified")}
            data-testid="machine-verified"
          >
            <MapPin className="h-4 w-4" />
            Подтверждён на месте
          </Button>
        ) : null}
      </div>
    </section>
  );
}
