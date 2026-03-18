"use client";
import { redirect } from "next/navigation";
import { use } from "react";

export default function SessionRedirectPage({
  params,
}: {
  params: Promise<{ projectId: string; sessionId: string }>;
}) {
  const { sessionId } = use(params);
  // Redirect to the canonical session URL
  redirect(`/dashboard/sessions/${sessionId}`);
}
