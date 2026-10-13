import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "晨充 · 找空位与充电预约",
  description: "查看玉泉附近空位，核对本人付款授权与套餐，预约单次云端充电。手机一屏预约，底部导航查看空位、记录与账号。",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "晨充", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f3f5f8" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
