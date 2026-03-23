import type { Route } from "next";
import { redirect } from "next/navigation";

export default async function BrainRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/projects/${id}/brain` as Route);
}
