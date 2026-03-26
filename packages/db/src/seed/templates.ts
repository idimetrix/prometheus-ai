/**
 * Built-in project templates with real starter file contents.
 * Each template provides a working scaffold that users can immediately
 * build upon after project creation.
 */

export interface ProjectTemplate {
  category: string;
  description: string;
  files: Record<string, string>;
  name: string;
  tags: string[];
  techStack: string[];
}

export const projectTemplates: ProjectTemplate[] = [
  {
    name: "SaaS Starter",
    description:
      "Full-stack SaaS boilerplate with auth, billing, and dashboard. Next.js + tRPC + Drizzle + Stripe.",
    category: "fullstack",
    tags: ["saas", "nextjs", "stripe", "auth", "dashboard"],
    techStack: [
      "next.js",
      "typescript",
      "trpc",
      "drizzle",
      "stripe",
      "tailwind",
    ],
    files: {
      "package.json": JSON.stringify(
        {
          name: "saas-starter",
          version: "0.1.0",
          private: true,
          scripts: {
            dev: "next dev",
            build: "next build",
            start: "next start",
            lint: "next lint",
            "db:push": "drizzle-kit push",
            "db:studio": "drizzle-kit studio",
          },
          dependencies: {
            next: "^14.2.0",
            react: "^18.3.0",
            "react-dom": "^18.3.0",
            "@trpc/server": "^10.45.0",
            "@trpc/client": "^10.45.0",
            "@trpc/next": "^10.45.0",
            "drizzle-orm": "^0.30.0",
            stripe: "^14.0.0",
            "next-auth": "^4.24.0",
            zod: "^3.22.0",
          },
          devDependencies: {
            typescript: "^5.4.0",
            "@types/react": "^18.3.0",
            tailwindcss: "^3.4.0",
            "drizzle-kit": "^0.21.0",
          },
        },
        null,
        2
      ),
      "src/app/layout.tsx": `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SaaS Starter",
  description: "Your SaaS application",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
      "src/app/page.tsx": `export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-4xl font-bold">Welcome to SaaS Starter</h1>
      <p className="mt-4 text-lg text-gray-600">
        Get started by editing src/app/page.tsx
      </p>
      <div className="mt-8 flex gap-4">
        <a href="/dashboard" className="rounded bg-blue-600 px-6 py-3 text-white hover:bg-blue-700">
          Dashboard
        </a>
        <a href="/pricing" className="rounded border px-6 py-3 hover:bg-gray-50">
          Pricing
        </a>
      </div>
    </main>
  );
}
`,
      "src/app/dashboard/page.tsx": `import { redirect } from "next/navigation";

export default function DashboardPage() {
  // TODO: Check auth session
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-lg border p-4">
          <h3 className="text-sm text-gray-500">Total Users</h3>
          <p className="text-3xl font-bold">0</p>
        </div>
        <div className="rounded-lg border p-4">
          <h3 className="text-sm text-gray-500">Revenue</h3>
          <p className="text-3xl font-bold">$0</p>
        </div>
        <div className="rounded-lg border p-4">
          <h3 className="text-sm text-gray-500">Active Plans</h3>
          <p className="text-3xl font-bold">0</p>
        </div>
      </div>
    </div>
  );
}
`,
      "src/server/db/schema.ts": `import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  stripeSubscriptionId: text("stripe_subscription_id").notNull(),
  plan: text("plan").notNull().default("free"),
  active: boolean("active").notNull().default(true),
  currentPeriodEnd: timestamp("current_period_end"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
`,
      "src/server/trpc.ts": `import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  // TODO: Verify auth session
  return next({ ctx });
});
`,
      "drizzle.config.ts": `import type { Config } from "drizzle-kit";

export default {
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
`,
      ".env.example": `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/saas
NEXTAUTH_SECRET=your-secret-here
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
`,
    },
  },
  {
    name: "Blog",
    description:
      "Markdown-powered blog with MDX support, syntax highlighting, and RSS feed. Built with Next.js.",
    category: "content",
    tags: ["blog", "mdx", "nextjs", "content", "seo"],
    techStack: ["next.js", "typescript", "mdx", "tailwind"],
    files: {
      "package.json": JSON.stringify(
        {
          name: "blog",
          version: "0.1.0",
          private: true,
          scripts: {
            dev: "next dev",
            build: "next build",
            start: "next start",
          },
          dependencies: {
            next: "^14.2.0",
            react: "^18.3.0",
            "react-dom": "^18.3.0",
            "@next/mdx": "^14.2.0",
            "gray-matter": "^4.0.3",
            "reading-time": "^1.5.0",
            "remark-gfm": "^4.0.0",
            "rehype-highlight": "^7.0.0",
          },
          devDependencies: {
            typescript: "^5.4.0",
            "@types/react": "^18.3.0",
            tailwindcss: "^3.4.0",
          },
        },
        null,
        2
      ),
      "src/app/page.tsx": `import { getAllPosts } from "@/lib/posts";
import Link from "next/link";

export default function BlogHome() {
  const posts = getAllPosts();
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-4xl font-bold">Blog</h1>
      <p className="mt-2 text-gray-600">Thoughts, ideas, and tutorials.</p>
      <div className="mt-8 space-y-8">
        {posts.map((post) => (
          <article key={post.slug} className="border-b pb-6">
            <Link href={\`/posts/\${post.slug}\`}>
              <h2 className="text-2xl font-semibold hover:text-blue-600">
                {post.title}
              </h2>
            </Link>
            <p className="mt-1 text-sm text-gray-500">{post.date} &middot; {post.readingTime}</p>
            <p className="mt-2 text-gray-700">{post.excerpt}</p>
          </article>
        ))}
      </div>
    </main>
  );
}
`,
      "src/lib/posts.ts": `import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const postsDirectory = path.join(process.cwd(), "content/posts");

export interface Post {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  readingTime: string;
  content: string;
}

export function getAllPosts(): Post[] {
  if (!fs.existsSync(postsDirectory)) return [];
  const files = fs.readdirSync(postsDirectory).filter((f) => f.endsWith(".mdx"));
  return files
    .map((file) => {
      const slug = file.replace(/\\.mdx$/, "");
      const raw = fs.readFileSync(path.join(postsDirectory, file), "utf-8");
      const { data, content } = matter(raw);
      const words = content.split(/\\s+/).length;
      const readingTime = \`\${Math.ceil(words / 200)} min read\`;
      return {
        slug,
        title: String(data.title ?? slug),
        date: String(data.date ?? ""),
        excerpt: String(data.excerpt ?? content.slice(0, 160)),
        readingTime,
        content,
      };
    })
    .sort((a, b) => (a.date > b.date ? -1 : 1));
}

export function getPostBySlug(slug: string): Post | undefined {
  const filePath = path.join(postsDirectory, \`\${slug}.mdx\`);
  if (!fs.existsSync(filePath)) return undefined;
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const words = content.split(/\\s+/).length;
  return {
    slug,
    title: String(data.title ?? slug),
    date: String(data.date ?? ""),
    excerpt: String(data.excerpt ?? content.slice(0, 160)),
    readingTime: \`\${Math.ceil(words / 200)} min read\`,
    content,
  };
}
`,
      "content/posts/hello-world.mdx": `---
title: "Hello World"
date: "2024-01-01"
excerpt: "Welcome to the blog! This is your first post."
---

# Hello World

Welcome to your new blog! Edit this file or create new \`.mdx\` files in
\`content/posts/\` to add more posts.

## Features

- MDX support for interactive components
- Syntax highlighting
- Reading time estimates
- RSS feed generation
`,
    },
  },
  {
    name: "API Server",
    description:
      "Production-ready REST API with Hono, Drizzle ORM, JWT auth, rate limiting, and OpenAPI docs.",
    category: "backend",
    tags: ["api", "hono", "rest", "jwt", "drizzle"],
    techStack: ["hono", "typescript", "drizzle", "jwt", "openapi"],
    files: {
      "package.json": JSON.stringify(
        {
          name: "api-server",
          version: "0.1.0",
          private: true,
          scripts: {
            dev: "tsx watch src/index.ts",
            build: "tsup src/index.ts",
            start: "node dist/index.js",
            "db:push": "drizzle-kit push",
          },
          dependencies: {
            hono: "^4.2.0",
            "drizzle-orm": "^0.30.0",
            postgres: "^3.4.0",
            zod: "^3.22.0",
            "hono-rate-limiter": "^0.3.0",
            jsonwebtoken: "^9.0.0",
          },
          devDependencies: {
            typescript: "^5.4.0",
            tsx: "^4.7.0",
            tsup: "^8.0.0",
            "drizzle-kit": "^0.21.0",
          },
        },
        null,
        2
      ),
      "src/index.ts": `import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authMiddleware } from "./middleware/auth";
import { usersRouter } from "./routes/users";
import { healthRouter } from "./routes/health";

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.route("/health", healthRouter);
app.route("/api/users", usersRouter);

console.log("API server running on http://localhost:3000");

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
};
`,
      "src/routes/users.ts": `import { Hono } from "hono";
import { z } from "zod";

const usersRouter = new Hono();

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
});

usersRouter.get("/", async (c) => {
  // TODO: Query from DB
  return c.json({ users: [], total: 0 });
});

usersRouter.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  // TODO: Insert into DB
  return c.json({ id: "user_123", ...parsed.data }, 201);
});

usersRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  // TODO: Query from DB
  return c.json({ id, email: "user@example.com", name: "User" });
});

export { usersRouter };
`,
      "src/routes/health.ts": `import { Hono } from "hono";

const healthRouter = new Hono();

healthRouter.get("/", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export { healthRouter };
`,
      "src/middleware/auth.ts": `import type { MiddlewareHandler } from "hono";

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice(7);
  // TODO: Verify JWT token
  await next();
};
`,
      "src/db/schema.ts": `import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
`,
    },
  },
  {
    name: "Dashboard",
    description:
      "Admin dashboard with charts, data tables, and sidebar navigation. React + Recharts + Tailwind.",
    category: "frontend",
    tags: ["dashboard", "admin", "charts", "react", "tailwind"],
    techStack: ["next.js", "typescript", "recharts", "tailwind", "shadcn"],
    files: {
      "package.json": JSON.stringify(
        {
          name: "dashboard",
          version: "0.1.0",
          private: true,
          scripts: {
            dev: "next dev",
            build: "next build",
            start: "next start",
          },
          dependencies: {
            next: "^14.2.0",
            react: "^18.3.0",
            "react-dom": "^18.3.0",
            recharts: "^2.12.0",
            "@tanstack/react-table": "^8.15.0",
          },
          devDependencies: {
            typescript: "^5.4.0",
            "@types/react": "^18.3.0",
            tailwindcss: "^3.4.0",
          },
        },
        null,
        2
      ),
      "src/app/page.tsx": `import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const data = [
  { name: "Jan", value: 400 },
  { name: "Feb", value: 300 },
  { name: "Mar", value: 600 },
  { name: "Apr", value: 800 },
  { name: "May", value: 500 },
  { name: "Jun", value: 900 },
];

export default function DashboardHome() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r bg-gray-50 p-4">
        <h2 className="text-lg font-bold">Dashboard</h2>
        <nav className="mt-6 space-y-2">
          <a href="/" className="block rounded px-3 py-2 bg-blue-50 text-blue-700">Overview</a>
          <a href="/analytics" className="block rounded px-3 py-2 hover:bg-gray-100">Analytics</a>
          <a href="/users" className="block rounded px-3 py-2 hover:bg-gray-100">Users</a>
          <a href="/settings" className="block rounded px-3 py-2 hover:bg-gray-100">Settings</a>
        </nav>
      </aside>
      <main className="flex-1 p-8">
        <h1 className="text-2xl font-bold">Overview</h1>
        <div className="mt-6 grid grid-cols-4 gap-4">
          <div className="rounded-lg border p-4">
            <p className="text-sm text-gray-500">Total Revenue</p>
            <p className="text-2xl font-bold">$45,231</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-gray-500">Users</p>
            <p className="text-2xl font-bold">2,350</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-gray-500">Orders</p>
            <p className="text-2xl font-bold">12,234</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-gray-500">Active Now</p>
            <p className="text-2xl font-bold">573</p>
          </div>
        </div>
        <div className="mt-8 h-80 rounded-lg border p-4">
          <h2 className="mb-4 font-semibold">Monthly Revenue</h2>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </main>
    </div>
  );
}
`,
      "src/components/data-table.tsx": `"use client";

interface Column<T> {
  header: string;
  accessorKey: keyof T;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
}: DataTableProps<T>) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b bg-gray-50">
          {columns.map((col) => (
            <th key={String(col.accessorKey)} className="px-4 py-3 text-left text-sm font-medium">
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          <tr key={i} className="border-b hover:bg-gray-50">
            {columns.map((col) => (
              <td key={String(col.accessorKey)} className="px-4 py-3 text-sm">
                {String(row[col.accessorKey] ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
`,
    },
  },
  {
    name: "E-Commerce",
    description:
      "Online store with product catalog, cart, and checkout. Next.js + Stripe integration.",
    category: "fullstack",
    tags: ["ecommerce", "store", "stripe", "cart", "products"],
    techStack: ["next.js", "typescript", "stripe", "tailwind"],
    files: {
      "package.json": JSON.stringify(
        {
          name: "ecommerce",
          version: "0.1.0",
          private: true,
          scripts: {
            dev: "next dev",
            build: "next build",
            start: "next start",
          },
          dependencies: {
            next: "^14.2.0",
            react: "^18.3.0",
            "react-dom": "^18.3.0",
            stripe: "^14.0.0",
            "@stripe/stripe-js": "^3.0.0",
            zustand: "^4.5.0",
          },
          devDependencies: {
            typescript: "^5.4.0",
            tailwindcss: "^3.4.0",
          },
        },
        null,
        2
      ),
      "src/app/page.tsx": `import { products } from "@/data/products";
import Link from "next/link";

export default function StorePage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-bold">Shop</h1>
      <div className="mt-8 grid grid-cols-3 gap-6">
        {products.map((product) => (
          <Link key={product.id} href={\`/products/\${product.id}\`} className="group rounded-lg border p-4 hover:shadow-md">
            <div className="aspect-square rounded bg-gray-100" />
            <h2 className="mt-4 font-semibold group-hover:text-blue-600">{product.name}</h2>
            <p className="mt-1 text-lg font-bold">\${(product.price / 100).toFixed(2)}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
`,
      "src/data/products.ts": `export interface Product {
  id: string;
  name: string;
  description: string;
  price: number; // in cents
  image?: string;
}

export const products: Product[] = [
  { id: "prod_1", name: "Basic T-Shirt", description: "Comfortable cotton tee", price: 2999 },
  { id: "prod_2", name: "Premium Hoodie", description: "Warm fleece hoodie", price: 5999 },
  { id: "prod_3", name: "Canvas Sneakers", description: "Classic everyday sneakers", price: 7999 },
  { id: "prod_4", name: "Leather Wallet", description: "Genuine leather billfold", price: 3499 },
  { id: "prod_5", name: "Backpack", description: "Durable daily carry", price: 8999 },
  { id: "prod_6", name: "Watch", description: "Minimalist analog watch", price: 12999 },
];
`,
      "src/store/cart.ts": `import { create } from "zustand";
import type { Product } from "@/data/products";

interface CartItem {
  product: Product;
  quantity: number;
}

interface CartStore {
  items: CartItem[];
  addItem: (product: Product) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  total: () => number;
}

export const useCart = create<CartStore>((set, get) => ({
  items: [],
  addItem: (product) =>
    set((state) => {
      const existing = state.items.find((i) => i.product.id === product.id);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
          ),
        };
      }
      return { items: [...state.items, { product, quantity: 1 }] };
    }),
  removeItem: (productId) =>
    set((state) => ({ items: state.items.filter((i) => i.product.id !== productId) })),
  updateQuantity: (productId, quantity) =>
    set((state) => ({
      items: state.items.map((i) =>
        i.product.id === productId ? { ...i, quantity: Math.max(0, quantity) } : i
      ).filter((i) => i.quantity > 0),
    })),
  clearCart: () => set({ items: [] }),
  total: () => get().items.reduce((sum, i) => sum + i.product.price * i.quantity, 0),
}));
`,
    },
  },
  {
    name: "Portfolio",
    description:
      "Personal portfolio site with projects showcase, about page, and contact form.",
    category: "frontend",
    tags: ["portfolio", "personal", "resume", "projects"],
    techStack: ["next.js", "typescript", "tailwind", "framer-motion"],
    files: {
      "package.json": JSON.stringify(
        {
          name: "portfolio",
          version: "0.1.0",
          private: true,
          scripts: {
            dev: "next dev",
            build: "next build",
            start: "next start",
          },
          dependencies: {
            next: "^14.2.0",
            react: "^18.3.0",
            "react-dom": "^18.3.0",
            "framer-motion": "^11.0.0",
          },
          devDependencies: {
            typescript: "^5.4.0",
            tailwindcss: "^3.4.0",
          },
        },
        null,
        2
      ),
      "src/app/page.tsx": `const projects = [
  { title: "Project Alpha", description: "A full-stack web app", tech: ["React", "Node.js"] },
  { title: "Project Beta", description: "Mobile-first dashboard", tech: ["Next.js", "Tailwind"] },
  { title: "Project Gamma", description: "Open source CLI tool", tech: ["TypeScript", "Node.js"] },
];

export default function Portfolio() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <section>
        <h1 className="text-5xl font-bold">Hi, I&apos;m Developer</h1>
        <p className="mt-4 text-xl text-gray-600">
          Full-stack engineer building modern web applications.
        </p>
      </section>

      <section className="mt-16">
        <h2 className="text-2xl font-bold">Projects</h2>
        <div className="mt-6 space-y-6">
          {projects.map((project) => (
            <div key={project.title} className="rounded-lg border p-6 hover:shadow-md transition-shadow">
              <h3 className="text-xl font-semibold">{project.title}</h3>
              <p className="mt-2 text-gray-600">{project.description}</p>
              <div className="mt-3 flex gap-2">
                {project.tech.map((t) => (
                  <span key={t} className="rounded-full bg-gray-100 px-3 py-1 text-sm">{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-2xl font-bold">Contact</h2>
        <form className="mt-6 space-y-4" action="/api/contact" method="POST">
          <input type="email" name="email" placeholder="Your email" required
            className="w-full rounded border px-4 py-2" />
          <textarea name="message" placeholder="Your message" rows={4} required
            className="w-full rounded border px-4 py-2" />
          <button type="submit" className="rounded bg-black px-6 py-2 text-white hover:bg-gray-800">
            Send Message
          </button>
        </form>
      </section>
    </main>
  );
}
`,
    },
  },
  {
    name: "Chat App",
    description:
      "Real-time chat application with rooms, user presence, and message history. Socket.io + React.",
    category: "fullstack",
    tags: ["chat", "realtime", "websocket", "socket.io"],
    techStack: ["next.js", "typescript", "socket.io", "tailwind"],
    files: {
      "package.json": JSON.stringify(
        {
          name: "chat-app",
          version: "0.1.0",
          private: true,
          scripts: {
            dev: "next dev",
            build: "next build",
            start: "next start",
            "dev:server": "tsx watch server/index.ts",
          },
          dependencies: {
            next: "^14.2.0",
            react: "^18.3.0",
            "react-dom": "^18.3.0",
            "socket.io": "^4.7.0",
            "socket.io-client": "^4.7.0",
          },
          devDependencies: {
            typescript: "^5.4.0",
            tsx: "^4.7.0",
            tailwindcss: "^3.4.0",
          },
        },
        null,
        2
      ),
      "src/app/page.tsx": `"use client";

import { useEffect, useRef, useState } from "react";

interface Message {
  id: string;
  user: string;
  text: string;
  timestamp: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [username, setUsername] = useState("");
  const [joined, setJoined] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = () => {
    if (!input.trim()) return;
    const msg: Message = {
      id: crypto.randomUUID(),
      user: username,
      text: input,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, msg]);
    // TODO: Emit via socket.io
    setInput("");
  };

  if (!joined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-lg border p-8 shadow-sm">
          <h1 className="text-2xl font-bold">Join Chat</h1>
          <input
            type="text"
            placeholder="Enter your name"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-4 w-full rounded border px-4 py-2"
            onKeyDown={(e) => e.key === "Enter" && username.trim() && setJoined(true)}
          />
          <button
            onClick={() => username.trim() && setJoined(true)}
            className="mt-3 w-full rounded bg-blue-600 py-2 text-white hover:bg-blue-700"
          >
            Join
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b px-4 py-3 font-semibold">Chat Room</header>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className="flex gap-2">
            <span className="font-semibold">{msg.user}:</span>
            <span>{msg.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="border-t p-4 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Type a message..."
          className="flex-1 rounded border px-4 py-2"
        />
        <button onClick={sendMessage} className="rounded bg-blue-600 px-6 py-2 text-white">
          Send
        </button>
      </div>
    </div>
  );
}
`,
      "server/index.ts": `import { Server } from "socket.io";

const io = new Server(3001, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join", (room: string) => {
    socket.join(room);
    io.to(room).emit("system", { message: \`\${socket.id} joined\` });
  });

  socket.on("message", (data: { room: string; user: string; text: string }) => {
    io.to(data.room).emit("message", {
      id: crypto.randomUUID(),
      user: data.user,
      text: data.text,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

console.log("Chat server running on port 3001");
`,
    },
  },
  {
    name: "CLI Tool",
    description:
      "Node.js command-line tool with argument parsing, interactive prompts, and colored output.",
    category: "tool",
    tags: ["cli", "terminal", "node", "commander"],
    techStack: ["typescript", "commander", "chalk", "inquirer"],
    files: {
      "package.json": JSON.stringify(
        {
          name: "my-cli",
          version: "0.1.0",
          bin: { "my-cli": "./dist/index.js" },
          scripts: {
            dev: "tsx src/index.ts",
            build: "tsup src/index.ts --format esm,cjs --dts",
          },
          dependencies: {
            commander: "^12.0.0",
            chalk: "^5.3.0",
            inquirer: "^9.2.0",
            ora: "^8.0.0",
          },
          devDependencies: {
            typescript: "^5.4.0",
            tsx: "^4.7.0",
            tsup: "^8.0.0",
          },
        },
        null,
        2
      ),
      "src/index.ts": `#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init";
import { buildCommand } from "./commands/build";

const program = new Command();

program
  .name("my-cli")
  .description("A helpful CLI tool")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(buildCommand);

program.parse();
`,
      "src/commands/init.ts": `import { Command } from "commander";

export const initCommand = new Command("init")
  .description("Initialize a new project")
  .option("-t, --template <name>", "Template to use", "default")
  .option("-d, --dir <path>", "Target directory", ".")
  .action(async (opts: { template: string; dir: string }) => {
    console.log(\`Initializing project with template: \${opts.template}\`);
    console.log(\`Target directory: \${opts.dir}\`);
    // TODO: Scaffold project files
    console.log("Done! Project initialized successfully.");
  });
`,
      "src/commands/build.ts": `import { Command } from "commander";

export const buildCommand = new Command("build")
  .description("Build the project")
  .option("-w, --watch", "Watch for changes")
  .option("--minify", "Minify output")
  .action(async (opts: { watch?: boolean; minify?: boolean }) => {
    console.log("Building project...");
    if (opts.watch) console.log("Watching for changes...");
    if (opts.minify) console.log("Minifying output...");
    // TODO: Run build process
    console.log("Build complete!");
  });
`,
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            esModuleInterop: true,
            outDir: "dist",
            rootDir: "src",
            declaration: true,
          },
          include: ["src"],
        },
        null,
        2
      ),
    },
  },
  {
    name: "Chrome Extension",
    description:
      "Browser extension scaffold with popup, content script, background worker, and options page.",
    category: "tool",
    tags: ["chrome", "extension", "browser", "manifest-v3"],
    techStack: ["typescript", "chrome-api", "vite"],
    files: {
      "package.json": JSON.stringify(
        {
          name: "chrome-extension",
          version: "0.1.0",
          private: true,
          scripts: {
            dev: "vite build --watch",
            build: "vite build",
          },
          devDependencies: {
            typescript: "^5.4.0",
            vite: "^5.2.0",
            "@crxjs/vite-plugin": "^2.0.0-beta.23",
          },
        },
        null,
        2
      ),
      "manifest.json": JSON.stringify(
        {
          manifest_version: 3,
          name: "My Extension",
          version: "0.1.0",
          description: "A helpful browser extension",
          permissions: ["storage", "activeTab"],
          action: {
            default_popup: "popup.html",
            default_icon: { "16": "icon16.png", "48": "icon48.png" },
          },
          background: { service_worker: "src/background.ts", type: "module" },
          content_scripts: [
            {
              matches: ["<all_urls>"],
              js: ["src/content.ts"],
            },
          ],
          options_page: "options.html",
        },
        null,
        2
      ),
      "popup.html": `<!DOCTYPE html>
<html>
<head>
  <style>
    body { width: 320px; padding: 16px; font-family: system-ui, sans-serif; }
    h1 { font-size: 18px; margin: 0 0 12px; }
    button { padding: 8px 16px; border-radius: 6px; border: none; background: #3b82f6; color: white; cursor: pointer; }
    button:hover { background: #2563eb; }
  </style>
</head>
<body>
  <h1>My Extension</h1>
  <p id="status">Ready</p>
  <button id="action-btn">Run Action</button>
  <script src="src/popup.ts" type="module"></script>
</body>
</html>
`,
      "src/popup.ts": `const btn = document.getElementById("action-btn");
const status = document.getElementById("status");

btn?.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: "run" });
    if (status) status.textContent = "Action sent!";
  }
});
`,
      "src/background.ts": `chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed");
  chrome.storage.local.set({ enabled: true });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "getState") {
    chrome.storage.local.get("enabled", (data) => {
      sendResponse({ enabled: data.enabled });
    });
    return true; // async response
  }
});
`,
      "src/content.ts": `chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "run") {
    console.log("Content script received action");
    // TODO: Modify page content
  }
});
`,
    },
  },
  {
    name: "Mobile App",
    description:
      "Cross-platform mobile app starter with React Native and Expo. Navigation, state management included.",
    category: "mobile",
    tags: ["mobile", "react-native", "expo", "ios", "android"],
    techStack: ["react-native", "expo", "typescript", "zustand"],
    files: {
      "package.json": JSON.stringify(
        {
          name: "mobile-app",
          version: "0.1.0",
          scripts: {
            start: "expo start",
            android: "expo start --android",
            ios: "expo start --ios",
            web: "expo start --web",
          },
          dependencies: {
            expo: "~50.0.0",
            react: "18.2.0",
            "react-native": "0.73.0",
            "expo-router": "~3.4.0",
            "@expo/vector-icons": "^14.0.0",
            zustand: "^4.5.0",
          },
          devDependencies: {
            typescript: "^5.4.0",
            "@types/react": "~18.2.0",
          },
        },
        null,
        2
      ),
      "app/_layout.tsx": `import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "Home" }} />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
    </Stack>
  );
}
`,
      "app/index.tsx": `import { View, Text, Pressable, StyleSheet } from "react-native";
import { Link } from "expo-router";

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome!</Text>
      <Text style={styles.subtitle}>Your mobile app is ready.</Text>
      <Link href="/settings" asChild>
        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>Go to Settings</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 32, fontWeight: "bold" },
  subtitle: { fontSize: 16, color: "#666", marginTop: 8 },
  button: { marginTop: 24, backgroundColor: "#3b82f6", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
`,
      "app/settings.tsx": `import { View, Text, Switch, StyleSheet } from "react-native";
import { useState } from "react";

export default function SettingsScreen() {
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.label}>Notifications</Text>
        <Switch value={notifications} onValueChange={setNotifications} />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Dark Mode</Text>
        <Switch value={darkMode} onValueChange={setDarkMode} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#eee" },
  label: { fontSize: 16 },
});
`,
      "app.json": JSON.stringify(
        {
          expo: {
            name: "mobile-app",
            slug: "mobile-app",
            version: "1.0.0",
            scheme: "mobile-app",
            platforms: ["ios", "android"],
            ios: { bundleIdentifier: "com.example.mobileapp" },
            android: { package: "com.example.mobileapp" },
          },
        },
        null,
        2
      ),
    },
  },
  {
    name: "Discord Bot",
    description:
      "Discord bot with slash commands, event handlers, and moderation tools. discord.js v14.",
    category: "tool",
    tags: ["discord", "bot", "chat", "moderation"],
    techStack: ["typescript", "discord.js", "node.js"],
    files: {
      "package.json": JSON.stringify(
        {
          name: "discord-bot",
          version: "0.1.0",
          scripts: {
            dev: "tsx watch src/index.ts",
            build: "tsup src/index.ts",
            start: "node dist/index.js",
            "deploy-commands": "tsx src/deploy-commands.ts",
          },
          dependencies: {
            "discord.js": "^14.14.0",
            dotenv: "^16.4.0",
          },
          devDependencies: {
            typescript: "^5.4.0",
            tsx: "^4.7.0",
            tsup: "^8.0.0",
          },
        },
        null,
        2
      ),
      "src/index.ts": `import { Client, GatewayIntentBits, Events } from "discord.js";
import "dotenv/config";
import { handleCommand } from "./commands";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(\`Bot ready! Logged in as \${c.user.tag}\`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await handleCommand(interaction);
});

client.login(process.env.DISCORD_TOKEN);
`,
      "src/commands/index.ts": `import type { ChatInputCommandInteraction } from "discord.js";
import { ping } from "./ping";
import { info } from "./info";

const commands: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
  ping,
  info,
};

export async function handleCommand(interaction: ChatInputCommandInteraction) {
  const handler = commands[interaction.commandName];
  if (handler) {
    await handler(interaction);
  } else {
    await interaction.reply({ content: "Unknown command", ephemeral: true });
  }
}
`,
      "src/commands/ping.ts": `import type { ChatInputCommandInteraction } from "discord.js";

export async function ping(interaction: ChatInputCommandInteraction) {
  const latency = Date.now() - interaction.createdTimestamp;
  await interaction.reply(\`Pong! Latency: \${latency}ms\`);
}
`,
      "src/commands/info.ts": `import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";

export async function info(interaction: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setTitle("Bot Info")
    .setColor(0x5865f2)
    .addFields(
      { name: "Servers", value: String(interaction.client.guilds.cache.size), inline: true },
      { name: "Uptime", value: \`\${Math.floor((interaction.client.uptime ?? 0) / 60000)}m\`, inline: true },
    )
    .setTimestamp();
  await interaction.reply({ embeds: [embed] });
}
`,
      ".env.example": `DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-client-id
DISCORD_GUILD_ID=your-guild-id
`,
    },
  },
  {
    name: "REST API",
    description:
      "Lightweight REST API with Express, Prisma, validation, error handling, and tests.",
    category: "backend",
    tags: ["rest", "express", "prisma", "api", "crud"],
    techStack: ["express", "typescript", "prisma", "zod"],
    files: {
      "package.json": JSON.stringify(
        {
          name: "rest-api",
          version: "0.1.0",
          scripts: {
            dev: "tsx watch src/index.ts",
            build: "tsup src/index.ts",
            start: "node dist/index.js",
            test: "vitest",
            "db:push": "prisma db push",
            "db:studio": "prisma studio",
          },
          dependencies: {
            express: "^4.18.0",
            "@prisma/client": "^5.11.0",
            zod: "^3.22.0",
            cors: "^2.8.5",
            helmet: "^7.1.0",
          },
          devDependencies: {
            typescript: "^5.4.0",
            tsx: "^4.7.0",
            tsup: "^8.0.0",
            prisma: "^5.11.0",
            vitest: "^1.4.0",
            "@types/express": "^4.17.0",
            "@types/cors": "^2.8.0",
          },
        },
        null,
        2
      ),
      "src/index.ts": `import express from "express";
import cors from "cors";
import helmet from "helmet";
import { todoRouter } from "./routes/todos";
import { errorHandler } from "./middleware/error-handler";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/todos", todoRouter);

app.use(errorHandler);

app.listen(port, () => {
  console.log(\`REST API running on http://localhost:\${port}\`);
});

export { app };
`,
      "src/routes/todos.ts": `import { Router } from "express";
import { z } from "zod";

const todoRouter = Router();

const createTodoSchema = z.object({
  title: z.string().min(1).max(200),
  completed: z.boolean().default(false),
});

const updateTodoSchema = createTodoSchema.partial();

todoRouter.get("/", async (_req, res) => {
  // TODO: Query from Prisma
  res.json({ todos: [], total: 0 });
});

todoRouter.post("/", async (req, res) => {
  const parsed = createTodoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  // TODO: Insert via Prisma
  res.status(201).json({ id: "todo_1", ...parsed.data });
});

todoRouter.get("/:id", async (req, res) => {
  const { id } = req.params;
  // TODO: Query from Prisma
  res.json({ id, title: "Sample Todo", completed: false });
});

todoRouter.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const parsed = updateTodoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  // TODO: Update via Prisma
  res.json({ id, ...parsed.data });
});

todoRouter.delete("/:id", async (req, res) => {
  const { id } = req.params;
  // TODO: Delete via Prisma
  res.status(204).send();
});

export { todoRouter };
`,
      "src/middleware/error-handler.ts": `import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  const status = err.status ?? 500;
  const message = status === 500 ? "Internal Server Error" : err.message;
  res.status(status).json({ error: message });
};
`,
      "prisma/schema.prisma": `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Todo {
  id        String   @id @default(cuid())
  title     String
  completed Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`,
      ".env.example": `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rest_api
PORT=3000
`,
    },
  },
];
