import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "晨充 · 尼普顿预约助手",
  description: "接好车辆，安排下一次充电。每个人独立管理自己的设备、预约和充电记录。",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
