import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "晨充 · 尼普顿预约助手",
  description: "安卓和 iPhone 可用的本机充电计划工具。个人数据只在使用者设备加密保存。",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "晨充", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#235140" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
