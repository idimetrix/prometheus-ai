import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="flex h-screen">
      <aside className="w-64 border-r bg-muted/30 p-4">
        <div className="mb-8 text-lg font-bold">PROMETHEUS</div>
        <nav className="space-y-1">
          {[
            { href: "/dashboard", label: "Home" },
            { href: "/dashboard/projects", label: "Projects" },
            { href: "/dashboard/fleet", label: "Fleet" },
            { href: "/dashboard/analytics", label: "Analytics" },
            { href: "/dashboard/settings", label: "Settings" },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm hover:bg-muted"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
