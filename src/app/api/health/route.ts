export async function GET() {
  return Response.json({ service: "neptune-charge-hub", configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.ACCOUNT_ENCRYPTION_KEY), chargingEnabled: process.env.CHARGING_ENABLED === "true" }, { headers: { "Cache-Control": "no-store" } });
}
