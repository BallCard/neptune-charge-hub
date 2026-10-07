import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";
const config: NextConfig = { poweredByHeader: false,
  async headers() { return [{ source: "/:path*", headers: [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Frame-Options", value: "DENY" },
  ] }, ...(process.env.NODE_ENV === "development" ? [{ source: "/dev-preview", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] }] : [])]; },
};
export default withWorkflow(config);
