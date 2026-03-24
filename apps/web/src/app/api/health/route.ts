import { NextResponse } from "next/server";

export async function GET() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  let apiStatus = "unknown";
  try {
    const res = await fetch(`${apiUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    apiStatus = res.ok ? "ok" : "degraded";
  } catch {
    apiStatus = "unreachable";
  }

  const allHealthy = apiStatus === "ok";

  return NextResponse.json(
    {
      status: allHealthy ? "ok" : "degraded",
      service: "web",
      version: process.env.APP_VERSION ?? "0.1.0",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      dependencies: {
        api: apiStatus,
      },
    },
    { status: allHealthy ? 200 : 503 }
  );
}
