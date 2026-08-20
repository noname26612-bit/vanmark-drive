"use client";
/* eslint-disable @next/next/no-img-element -- фото отдаются через /api/attachments/:id по сессионной
   куке; next/image ходит через свой прокси без куки и получил бы 404. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

// Полноэкранный просмотр фото для водительского PWA. Раньше фото открывалось ссылкой в новой вкладке
// браузера (target=_blank) — в Android/TWA её нельзя закрыть привычным жестом, фото «залипало».
// Здесь — встроенный просмотрщик: закрывается крестиком, тапом по фону, свайпом вверх/вниз и
// аппаратной кнопкой «назад» (через запись в history, чтобы «назад» не выходил из приложения).
// Принимает НАБОР фото одной группы (фото диспетчера / свои / фото станка) и листает внутри него:
// водителю обычно нужно пересмотреть все снимки подряд, а не открывать каждый заново.

const AXIS_LOCK_PX = 10; // с какого сдвига решаем, жест горизонтальный или вертикальный
const SWIPE_NEXT_PX = 60; // порог листания вбок
const SWIPE_CLOSE_PX = 120; // порог закрытия свайпом вверх/вниз
const EDGE_RUBBER = 0.25; // на крайнем фото палец «упирается»: сдвиг гасим, закольцовывания нет

export function PhotoLightbox({
  urls,
  index = 0,
  onClose,
}: {
  urls: string[];
  index?: number;
  onClose: () => void;
}) {
  const [cur, setCur] = useState(() => Math.min(Math.max(index, 0), Math.max(0, urls.length - 1)));
  const [dx, setDx] = useState(0); // смещение по горизонтали во время листания
  const [dy, setDy] = useState(0); // смещение по вертикали во время свайпа закрытия
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"x" | "y" | null>(null); // ось жеста фиксируем один раз и до конца касания
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  // Длина набора нужна в стабильных колбэках ниже: их зависимости обязаны остаться пустыми,
  // иначе эффект с pushState (см. ниже) перезапустится и запишет в history лишнюю строку.
  const countRef = useRef(urls.length);
  useEffect(() => {
    countRef.current = urls.length;
  }, [urls.length]);

  // Листание. Без закольцовывания: на крайнем фото шаг «за границу» ничего не меняет.
  // Смена фото всегда обнуляет накопленный сдвиг — иначе новый снимок появлялся бы уже сдвинутым.
  const go = useCallback((delta: number) => {
    setCur((i) => Math.min(Math.max(i + delta, 0), Math.max(0, countRef.current - 1)));
    setDx(0);
    setDy(0);
  }, []);

  // Закрытие пользователем: если открытие добавило запись в history — откатываем её (popstate вызовет
  // onClose), иначе закрываем напрямую. Стабильная ссылка — читает только refs/window.
  const requestClose = useCallback(() => {
    const st = typeof window !== "undefined" ? (window.history.state as { vmLightbox?: boolean } | null) : null;
    if (st?.vmLightbox) window.history.back();
    else onCloseRef.current();
  }, []);

  // Пока открыто: ловим аппаратную «назад» (popstate), Esc и стрелки; добавляем запись в history.
  // ВАЖНО: запись в history делается РОВНО ОДИН РАЗ на открытие (зависимости эффекта стабильны).
  // Если писать её на каждое листание, аппаратная «назад» в Android/TWA станет отматывать фото
  // назад вместо закрытия просмотра — водитель не сможет выйти привычным жестом.
  useEffect(() => {
    const onPop = () => onCloseRef.current();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.history.pushState({ vmLightbox: true }, "");
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
  }, [requestClose, go]);

  if (urls.length === 0) return null;
  // Набор мог сократиться (фото удалили) уже после открытия — держим индекс в границах.
  const i = Math.min(Math.max(cur, 0), urls.length - 1);
  const many = urls.length > 1;

  return (
    <div
      className="fixed inset-0 z-[70] flex touch-none items-center justify-center bg-black/90"
      onClick={requestClose}
      style={{ opacity: Math.max(0.35, 1 - Math.abs(dy) / 400) }}
    >
      {many ? (
        <span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-sm font-medium text-white">
          {i + 1} / {urls.length}
        </span>
      ) : null}
      <button
        type="button"
        aria-label="Закрыть"
        onClick={(e) => {
          e.stopPropagation();
          requestClose();
        }}
        className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white active:bg-white/30"
      >
        <X className="h-6 w-6" />
      </button>

      {/* Стрелки — для мыши и планшета. На узком экране их прячем: там листают свайпом, а кнопки
          по краям перекрывали бы само фото. */}
      {many ? (
        <>
          <button
            type="button"
            aria-label="Предыдущее фото"
            disabled={i === 0}
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            className="absolute left-3 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white active:bg-white/30 disabled:opacity-25 sm:flex"
          >
            <ChevronLeft className="h-7 w-7" />
          </button>
          <button
            type="button"
            aria-label="Следующее фото"
            disabled={i === urls.length - 1}
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            className="absolute right-3 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white active:bg-white/30 disabled:opacity-25 sm:flex"
          >
            <ChevronRight className="h-7 w-7" />
          </button>
        </>
      ) : null}

      <img
        src={urls[i]}
        alt="фото"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          axis.current = null;
          setDragging(true);
        }}
        onTouchMove={(e) => {
          const s = start.current;
          if (!s) return;
          const mx = e.touches[0].clientX - s.x;
          const my = e.touches[0].clientY - s.y;
          // Ось выбираем один раз при первом заметном сдвиге и больше не пересматриваем: иначе
          // диагональный жест на ходу перескакивал бы между листанием и закрытием.
          //
          // Когда фото ОДНО, горизонтальной оси не существует вовсе. Иначе привычный жест «потянуть
          // вниз, чтобы закрыть» с обычным для большого пальца уводом вбок фиксировал бы ось «x»,
          // и снимок просто дёргался бы вбок, не закрываясь, — на водительском экране это отрезало
          // бы единственный жест, которым его учили закрывать.
          if (axis.current === null) {
            if (Math.abs(mx) < AXIS_LOCK_PX && Math.abs(my) < AXIS_LOCK_PX) return;
            axis.current = many && Math.abs(mx) > Math.abs(my) ? "x" : "y";
          }
          if (axis.current === "x") {
            const atEdge = (mx > 0 && i === 0) || (mx < 0 && i === urls.length - 1);
            setDx(atEdge ? mx * EDGE_RUBBER : mx);
          } else {
            setDy(my);
          }
        }}
        onTouchEnd={() => {
          if (axis.current === "x") {
            if (Math.abs(dx) > SWIPE_NEXT_PX) go(dx < 0 ? 1 : -1); // go сам упрётся в границу набора
            setDx(0);
          } else if (Math.abs(dy) > SWIPE_CLOSE_PX) {
            requestClose();
          } else {
            setDy(0);
          }
          start.current = null;
          axis.current = null;
          setDragging(false);
        }}
        className="max-h-full max-w-full object-contain"
        style={{
          transform: `translate(${dx}px, ${dy}px)`,
          transition: dragging ? "none" : "transform 0.2s",
        }}
      />
      <p className="pointer-events-none absolute inset-x-0 bottom-5 text-center text-xs text-white/60">
        {many ? "Листайте вбок · потяните вверх или вниз, чтобы закрыть" : "Потяните вверх или вниз, чтобы закрыть"}
      </p>
    </div>
  );
}
