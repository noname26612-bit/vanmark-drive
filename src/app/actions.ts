"use server";

import { signOut } from "@/lib/auth";

/** Выход: чистим сессию и уводим на страницу входа. */
export async function logout(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
