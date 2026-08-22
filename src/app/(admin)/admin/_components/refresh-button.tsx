"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * «Обновить» на «Управлении»: страница серверная и данные на ней живые, но сама себя не
 * перезапрашивает. Кнопка вместо поллинга — экран открывают утром и смотрят минуту, держать ради
 * этого опрос каждые 15 секунд незачем (CLAUDE.md: не переусложнять).
 */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [at, setAt] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {at ? <span className="text-xs text-neutral-400">обновлено в {at}</span> : null}
      <Button
        variant="secondary"
        className="h-9"
        disabled={pending}
        data-testid="admin-refresh"
        onClick={() =>
          startTransition(() => {
            router.refresh();
            setAt(
              new Intl.DateTimeFormat("ru-RU", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Europe/Moscow",
              }).format(new Date()),
            );
          })
        }
      >
        <RotateCw className="h-4 w-4" /> {pending ? "Обновляем…" : "Обновить"}
      </Button>
    </div>
  );
}
