import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SwRegister } from "@/components/sw-register";
import { ClientErrorReporter } from "@/components/client-error-reporter";

export const metadata: Metadata = {
  title: "VanMark Drive",
  description: "Сервис планирования и учёта задач водителей VanMark",
  // PWA-установка (Этап 5). <link rel="manifest"> Next подставляет сам из app/manifest.ts.
  appleWebApp: { capable: true, statusBarStyle: "default", title: "VanMark" },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-white text-neutral-900 antialiased">
        {children}
        <SwRegister />
        <ClientErrorReporter />
      </body>
    </html>
  );
}
