import type { Metadata, Viewport } from "next";
import "./fonts.css";
import "./globals.css";
import { personalOnly } from '@/lib/edition';
export const metadata: Metadata = {
  title: personalOnly ? "晨充 · 个人充电预约" : "晨充 · 找空位与充电预约",
  description: personalOnly ? "查看玉泉插座状态，核对本人付款授权与套餐，预约单次云端开电；电脑无需开机。" : "查看玉泉附近空位，核对本人付款授权与套餐，预约单次云端充电。查空位、预约充电与我的预约，使用真实站点和插座状态。",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "晨充", statusBarStyle: "default" },
  icons: { icon: "/brand.svg", apple: "/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content", themeColor: "#f8fafc" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
