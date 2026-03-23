import type { Route } from "next";
import { redirect } from "next/navigation";

export default async function SessionRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/sessions/${id}` as Route);
}
