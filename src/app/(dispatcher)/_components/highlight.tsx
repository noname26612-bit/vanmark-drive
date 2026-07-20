"use client";

import type { ReactNode } from "react";
import {
  highlightRanges,
  phoneHighlightRanges,
  type ParsedQuery,
} from "@/lib/task-search";

/**
 * Текст с подсветкой совпадений поиска (<mark>). query=null / неактивный — просто текст.
 * phone — подсветка по цифрам (телефон в любом формате записи); если по цифрам не совпало,
 * пробуем обычное текстовое совпадение (запрос мог попасть в форматирование).
 */
export function Highlighted({
  text,
  query,
  phone = false,
}: {
  text: string;
  query: ParsedQuery | null;
  phone?: boolean;
}) {
  if (!query?.active || !text) return <>{text}</>;
  let ranges = phone ? phoneHighlightRanges(text, query) : highlightRanges(text, query);
  if (phone && ranges.length === 0) ranges = highlightRanges(text, query);
  if (ranges.length === 0) return <>{text}</>;

  const parts: ReactNode[] = [];
  let pos = 0;
  ranges.forEach((r, i) => {
    if (r.start > pos) parts.push(text.slice(pos, r.start));
    parts.push(
      // Янтарная заливка — «требует взгляда сейчас» (ui-guidelines); текст не перекрашиваем.
      <mark key={i} className="rounded-[2px] bg-amber-100 text-inherit">
        {text.slice(r.start, r.end)}
      </mark>,
    );
    pos = r.end;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}
