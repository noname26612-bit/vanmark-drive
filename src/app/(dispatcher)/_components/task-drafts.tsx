"use client";

// Провайдер и плашка свёрнутых черновиков заявки (доработка №1). Живёт в лейауте диспетчера, поэтому
// один общий стек черновиков виден и на «Сегодня», и на «Все задачи». Хранилище — localStorage
// (переживает перезагрузку и закрытие вкладки). Экраны создания (board/all-tasks) читают контекст:
// сохраняют черновик при сворачивании формы и открывают его заново по клику в плашке.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FileText, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DRAFTS_STORAGE_KEY,
  draftLabel,
  type FormState,
  type TaskDraft,
} from "@/lib/task-draft";

type OpenHandler = (draft: TaskDraft) => void;

type DraftsContextValue = {
  drafts: TaskDraft[];
  // Сохранить/обновить черновик. id задан — обновляем существующий (не плодим дубли при повторном
  // сворачивании того же черновика); id пуст — создаём новый. Возвращает id сохранённого черновика.
  upsertDraft: (form: FormState, id?: string | null) => string;
  removeDraft: (id: string) => void;
  // Открыть черновик: плашка вызывает requestOpen(draft), активный экран (board/all-tasks) заранее
  // зарегистрировал обработчик через registerOpenHandler (паттерн подписки — setState происходит в
  // обработчике клика, а не в теле эффекта). registerOpenHandler возвращает функцию отписки.
  requestOpen: (draft: TaskDraft) => void;
  registerOpenHandler: (fn: OpenHandler) => () => void;
};

const DraftsContext = createContext<DraftsContextValue | null>(null);

function newId(): string {
  // crypto.randomUUID есть во всех целевых браузерах (PWA, современный Chrome); фолбэк на всякий случай.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `d_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

function readStored(): TaskDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DRAFTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Доверяем структуре мягко: берём только объекты с id и form (совместимость версий обеспечивает ключ).
    return parsed.filter(
      (d): d is TaskDraft =>
        !!d && typeof d === "object" && typeof (d as TaskDraft).id === "string" && !!(d as TaskDraft).form,
    );
  } catch {
    return [];
  }
}

export function TaskDraftsProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<TaskDraft[]>([]);
  const openHandlerRef = useRef<OpenHandler | null>(null);
  const hydrated = useRef(false);

  // Загрузка из localStorage — только на клиенте после монтирования (SSR отдаёт пусто, без гидрационных
  // расхождений). Дальше синхронизируем изменения обратно в localStorage. setState в эффекте здесь
  // намеренный и одноразовый — это синхронизация с внешним хранилищем (localStorage), а не производное
  // состояние; лениво из useState нельзя (сломает SSR-гидрацию: сервер localStorage не видит).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- гидрация из localStorage, см. коммент выше
    setDrafts(readStored());
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
    } catch {
      // переполнение/приватный режим — черновик просто не переживёт перезагрузку, роняться не за чем
    }
  }, [drafts]);

  // Синхронизация между вкладками: если в другой вкладке диспетчера изменились черновики — подхватываем.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === DRAFTS_STORAGE_KEY) setDrafts(readStored());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const upsertDraft = useCallback((form: FormState, id?: string | null): string => {
    const draftId = id ?? newId();
    const entry: TaskDraft = { id: draftId, form, savedAt: Date.now(), label: draftLabel(form) };
    setDrafts((prev) => {
      const rest = prev.filter((d) => d.id !== draftId);
      return [entry, ...rest]; // свежий — наверх стека
    });
    return draftId;
  }, []);

  const removeDraft = useCallback((id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const registerOpenHandler = useCallback((fn: OpenHandler) => {
    openHandlerRef.current = fn;
    return () => {
      if (openHandlerRef.current === fn) openHandlerRef.current = null;
    };
  }, []);

  const requestOpen = useCallback((draft: TaskDraft) => {
    openHandlerRef.current?.(draft);
  }, []);

  const value = useMemo(
    () => ({ drafts, upsertDraft, removeDraft, requestOpen, registerOpenHandler }),
    [drafts, upsertDraft, removeDraft, requestOpen, registerOpenHandler],
  );

  return (
    <DraftsContext.Provider value={value}>
      {children}
      <TaskDraftsBar />
    </DraftsContext.Provider>
  );
}

export function useTaskDrafts(): DraftsContextValue {
  const ctx = useContext(DraftsContext);
  if (!ctx) throw new Error("useTaskDrafts должен использоваться внутри TaskDraftsProvider");
  return ctx;
}

// Плашка со свёрнутыми черновиками — фикс внизу справа, стек чипов (свежие сверху). Нейтральная
// графитовая палитра (черновик — не статус, цветом не сигналим). По телу чипа — открыть, крестик — удалить.
function TaskDraftsBar() {
  const { drafts, requestOpen, removeDraft } = useTaskDrafts();
  if (drafts.length === 0) return null;
  return (
    <div
      data-testid="drafts-bar"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-end p-4"
    >
      <div className="flex w-full max-w-xs flex-col gap-2">
        {drafts.map((d) => (
          <div
            key={d.id}
            data-testid="draft-chip"
            className={cn(
              "pointer-events-auto flex items-center gap-2 rounded-xl border border-neutral-300 bg-white",
              "px-3 py-2 shadow-lg motion-safe:animate-[draftIn_180ms_ease-out]",
            )}
          >
            <button
              type="button"
              data-testid="draft-open"
              onClick={() => requestOpen(d)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title="Открыть черновик заявки"
            >
              <FileText className="h-4 w-4 shrink-0 text-neutral-500" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-neutral-800">{d.label}</span>
                <span className="text-xs text-neutral-500">Черновик заявки</span>
              </span>
            </button>
            <button
              type="button"
              data-testid="draft-remove"
              onClick={() => removeDraft(d.id)}
              aria-label="Удалить черновик"
              className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
