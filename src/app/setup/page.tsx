import { notFound } from "next/navigation";
import SetupForm from "./setup-form";
export default function SetupPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SetupForm configured={Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)} />;
}
