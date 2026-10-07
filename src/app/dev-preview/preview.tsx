"use client";
import { useState } from "react";
import ChargeDashboard from "@/components/charge-dashboard";
import type { DashboardState } from "@/lib/contracts";
export default function Preview() {
  const [state, setState] = useState<DashboardState>(() => ({
    userEmail: "ui-check@example.test", configured: true, chargingEnabled: true,
    targets: [{ id: "11111111-1111-4111-8111-111111111111", label: "宿舍楼下 · 页面测试", device: "12345678", port: "06" }],
    preferences: { defaultTime: "06:00", weekdays: [1, 2, 3, 4, 5], maxPrepayCents: 200 },
    reservations: [], live: null, error: "离线界面验证：此页所有设备和记录都是测试数据，按钮不会发送真实预约。",
  }));
  async function action(name: string, payload: Record<string, unknown>) {
    if (name === "reserve") setState(previous => ({ ...previous, reservations: [{
      id: "test-reservation", target_id: String(payload.targetId), scheduled_at: String(payload.scheduledAt),
      phase: "scheduled", created_at: new Date().toISOString(), result: "仅用于页面验证，没有登记真实云端预约。",
    }] }));
    if (name === "cancel") setState(previous => ({ ...previous, reservations: previous.reservations.map(r => ({ ...r, phase: "cancelled" })) }));
    if (name === "savePreferences") setState(previous => ({ ...previous, preferences: payload as DashboardState["preferences"] }));
  }
  return <ChargeDashboard state={state} busy={false} onAction={action} onLogout={() => setState(previous => ({ ...previous, configured: false }))} />;
}
