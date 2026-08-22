import { requireRole } from "@/lib/session";
import { DriversClient } from "./drivers-client";

export const dynamic = "force-dynamic";

// «Пользователи и доступ» (02.07 — водители, 22.08.2026 — учётки офиса): вход и пароль. Только админ.
// Свой id уходит на клиент, чтобы не предлагать администратору закрыть вход самому себе (сервер
// такой запрос всё равно отклонит — кнопка-ловушка была бы обманом).
export default async function DriversPage() {
  const user = await requireRole("ADMIN");
  return <DriversClient currentUserId={user.id} />;
}
