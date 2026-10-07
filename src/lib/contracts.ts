export type Preferences = { defaultTime: string; weekdays: number[]; maxPrepayCents: number };
export type TargetRow = { id: string; label: string; device: string; port: string };
export type ReservationView = {
  id: string; target_id: string; scheduled_at: string; phase: string;
  result?: string | null; created_at: string;
};
export type DashboardState = {
  userEmail: string; configured: boolean; chargingEnabled: boolean;
  targets: TargetRow[]; preferences: Preferences; reservations: ReservationView[];
  live: null | { balanceCents: number; powerWatts: number | null; businessOpen: boolean;
    activeOrder: boolean; updatedAt: string };
  error?: string;
};
export const defaultPreferences: Preferences = {
  defaultTime: "06:00", weekdays: [1, 2, 3, 4, 5], maxPrepayCents: 200,
};
