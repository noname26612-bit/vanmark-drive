import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { homeForRole } from "@/domain/roles";
import { LoginForm } from "./login-form";

// Если уже вошёл — на свой экран, форму не показываем.
export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(homeForRole(user.role));

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-neutral-900">VanMark Drive</h1>
        <p className="mb-6 text-sm text-neutral-500">Вход в сервис задач водителей</p>
        <LoginForm />
      </div>
    </main>
  );
}
