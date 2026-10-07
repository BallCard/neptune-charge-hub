import { notFound } from "next/navigation";
import Preview from "./preview";
export default async function DevPreview({ searchParams }: { searchParams: Promise<{ mobile?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  if ((await searchParams).mobile === "1") return <main style={{ padding: 24, display: "grid", justifyContent: "center", gap: 12 }}><p>手机布局验证 · 390像素 · 离线测试数据</p><iframe title="手机界面验证" src="/dev-preview" width={390} height={844} style={{ border: "1px solid #ddd", borderRadius: 16 }} /></main>;
  return <Preview />;
}
