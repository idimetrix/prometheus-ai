"use client";
import { use } from "react";
import { redirect } from "next/navigation";

export default function SessionRedirectPage({
  params,
}: {
  params: Promise<{ projectId: string; sessionId: string }>;
}) {
  const { sessionId } = use(params);
  // Redirect to the canonical session URL
  redirect(`/dashboard/sessions/${sessionId}`);
}
