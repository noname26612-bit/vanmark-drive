"use client";
// Аварийный экран последней инстанции (ошибка в корневом layout). До 31.07 boundaries не было вовсе:
// любая ошибка рендера/гидратации (например, не загрузился чанк на плохой сети) давала белый экран
// без кнопки — водитель «застревал на логотипе». global-error обязан сам рендерить <html>/<body>.
import { useEffect } from "react";
import { reportClientError } from "@/lib/report";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => reportClientError(error, "error-boundary:global"), [error]);
  return (
    <html lang="ru">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <div style={{ padding: "48px 24px", maxWidth: 448, margin: "0 auto", textAlign: "center" }}>
          <p style={{ fontSize: 18, fontWeight: 600, color: "#171717" }}>Что-то сломалось</p>
          <p style={{ marginTop: 8, fontSize: 15, color: "#525252" }}>
            Обновите экран — обычно этого достаточно.
          </p>
          <button
            type="button"
            onClick={() => {
              reset();
              window.location.reload();
            }}
            style={{
              marginTop: 24,
              height: 56,
              width: "100%",
              borderRadius: 12,
              border: "none",
              background: "#4f46e5",
              color: "#fff",
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            Обновить
          </button>
        </div>
      </body>
    </html>
  );
}
