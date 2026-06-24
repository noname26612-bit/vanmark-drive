import { NextResponse } from "next/server";

// Digital Asset Links для TWA (docs/TWA.md): подтверждает связь домена с Android-приложением, чтобы
// оно открывалось без адресной строки (verified TWA). Отпечаток ключа подписи задаётся через env
// после сборки APK; без него отдаём пустой список — приложение работает, но с тонкой адресной строкой.
// Публичный по стандарту (как manifest): без авторизации, приватного не раскрывает.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const fingerprint = process.env.TWA_SHA256_FINGERPRINT?.trim();
  const packageName = process.env.TWA_PACKAGE_NAME?.trim() || "ru.vmdrive.twa";
  if (!fingerprint) return NextResponse.json([]);
  return NextResponse.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: [fingerprint],
      },
    },
  ]);
}
