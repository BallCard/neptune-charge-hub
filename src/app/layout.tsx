import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "晨充 · 尼普顿预约助手",
  description: "上传插座二维码，选择实际方案，预约明天6点开电。自动执行由安卓本机助手完成，账号与预约加密存于手机。",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "晨充", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#235140" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
