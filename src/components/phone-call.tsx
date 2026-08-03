"use client";

// Кнопка «Позвонить» и список номеров (03.08.2026). В заявке телефон — одна свободная строка,
// и Милена пишет туда несколько номеров. Раньше весь текст уходил в href="tel:…" целиком —
// водитель получал в поле набора мусор. Теперь: один номер — прямая ссылка (как было),
// несколько — КАЖДЫЙ отдельной строкой со своей ссылкой (решение Артёма 03.08).
//
// Тач-цели у водителя ≥48px (ui-guidelines) — все строки списка h-12.

import { useState } from "react";
import { Phone, ChevronDown, ChevronUp } from "lucide-react";
import { parsePhones, type ParsedPhone } from "@/lib/phone";

/** Подпись/добавочный мелким справа от номера. */
function PhoneMeta({ phone, className = "" }: { phone: ParsedPhone; className?: string }) {
  if (!phone.label && !phone.ext) return null;
  return (
    <span className={`truncate text-xs font-normal ${className}`}>
      {phone.label ?? ""}
      {phone.label && phone.ext ? " · " : ""}
      {phone.ext ? `доб. ${phone.ext}` : ""}
    </span>
  );
}

/** Строка списка номеров: отдельная ссылка на конкретный номер. */
function PhoneRow({ phone, filled }: { phone: ParsedPhone; filled: boolean }) {
  return (
    <a
      data-testid="call-option"
      href={phone.href}
      aria-label={`Позвонить ${phone.display}`}
      className={`inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg px-3 text-base font-medium ${
        filled ? "bg-green-600 text-white" : "border border-green-600 bg-white text-green-700"
      }`}
    >
      <Phone className="h-5 w-5 shrink-0" />
      <span className="truncate">{phone.display}</span>
      <PhoneMeta phone={phone} className={filled ? "text-green-100" : "text-green-600/70"} />
    </a>
  );
}

/**
 * Кнопка звонка у водителя.
 * - `compact` — в карточке списка задач, рядом с «Навигатор». Несколько номеров раскрываются
 *   списком под кнопками (родитель — flex-wrap, список занимает всю ширину и переносится).
 * - `full` — в детальной карточке: несколько номеров показываются сразу, без лишнего тапа.
 */
export function CallButton({
  phone,
  variant,
  className = "",
}: {
  phone: string | null | undefined;
  variant: "compact" | "full";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const list = parsePhones(phone);
  const raw = (phone ?? "").trim();

  if (list.length === 0) {
    // Номер не распознан, но что-то записано — в детальной карточке показываем текстом,
    // чтобы информация не пропала; в списке задач места нет.
    if (!raw || variant === "compact") return null;
    return <p className={`text-sm text-neutral-500 ${className}`}>{raw}</p>;
  }

  if (variant === "full") {
    if (list.length === 1) {
      return (
        <a
          data-testid="call-button"
          href={list[0].href}
          aria-label={`Позвонить ${list[0].display}`}
          className={`mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-green-600 text-base font-medium text-white ${className}`}
        >
          <Phone className="h-5 w-5" /> Позвонить · {list[0].display}
        </a>
      );
    }
    return (
      <div className={`mt-2 ${className}`}>
        <p className="mb-1.5 text-xs uppercase tracking-wide text-neutral-400">
          Телефоны · {list.length}
        </p>
        <div data-testid="call-list" className="flex flex-col gap-2">
          {list.map((p, i) => (
            <PhoneRow key={`${p.digits}-${p.ext ?? ""}`} phone={p} filled={i === 0} />
          ))}
        </div>
      </div>
    );
  }

  // compact
  if (list.length === 1) {
    return (
      <a
        data-testid="call-button"
        href={list[0].href}
        aria-label={`Позвонить ${list[0].display}`}
        className={`inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-50 text-sm font-medium text-green-700 ${className}`}
      >
        <Phone className="h-4 w-4" /> Позвонить
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        data-testid="call-button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-50 text-sm font-medium text-green-700 ${className}`}
      >
        <Phone className="h-4 w-4" /> Позвонить · {list.length}
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open ? (
        <div data-testid="call-list" className="flex w-full flex-col gap-2 pt-1">
          {list.map((p, i) => (
            <PhoneRow key={`${p.digits}-${p.ext ?? ""}`} phone={p} filled={i === 0} />
          ))}
        </div>
      ) : null}
    </>
  );
}

/** Телефоны строкой — карточка диспетчера (десктоп): каждый номер отдельной ссылкой. */
export function PhoneLinks({ phone, className = "" }: { phone: string | null | undefined; className?: string }) {
  const list = parsePhones(phone);
  const raw = (phone ?? "").trim();
  if (list.length === 0) return raw ? <span className={className}>{raw}</span> : null;

  return (
    <span data-testid="phone-links" className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      {list.map((p) => (
        <a
          key={`${p.digits}-${p.ext ?? ""}`}
          data-testid="call-option"
          href={p.href}
          className="inline-flex items-center gap-1 text-blue-600"
        >
          <Phone className="h-3.5 w-3.5" /> {p.display}
          <PhoneMeta phone={p} className="text-neutral-400" />
        </a>
      ))}
    </span>
  );
}
