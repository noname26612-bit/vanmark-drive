import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { homeForRole } from "@/domain/roles";

// Корень разводит по ролям: вошедшего — на его экран, гостя — на вход.
export default async function RootPage() {
  const user = await getSessionUser();
  redirect(user ? homeForRole(user.role) : "/login");
}
