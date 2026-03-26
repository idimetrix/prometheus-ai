"use client";

import {
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@prometheus/ui";
import { Loader2, Package, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ComponentCard } from "@/components/marketplace/component-card";
import { trpc } from "@/lib/trpc";

const CATEGORIES = [
  { value: "all", label: "All Categories" },
  { value: "button", label: "Button" },
  { value: "form", label: "Form" },
  { value: "layout", label: "Layout" },
  { value: "navigation", label: "Navigation" },
  { value: "data-display", label: "Data Display" },
  { value: "feedback", label: "Feedback" },
  { value: "overlay", label: "Overlay" },
  { value: "chart", label: "Chart" },
  { value: "other", label: "Other" },
] as const;

type SortOption = "downloads" | "rating" | "newest";

type CategoryValue = (typeof CATEGORIES)[number]["value"];

export default function MarketplacePage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryValue>("all");
  const [sortBy, setSortBy] = useState<SortOption>("downloads");

  const componentsQuery = trpc.marketplace.list.useQuery(
    {
      search: search || undefined,
      category:
        category === "all"
          ? undefined
          : (category as Exclude<CategoryValue, "all">),
      sortBy,
      limit: 24,
    },
    { retry: 2 }
  );

  const installMutation = trpc.marketplace.install.useMutation();

  const components = componentsQuery.data?.components ?? [];

  async function handleInstall(componentId: string) {
    try {
      const result = await installMutation.mutateAsync({ componentId });
      await navigator.clipboard.writeText(result.code);
      toast.success("Code copied to clipboard!");
    } catch {
      toast.error("Failed to install component");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl text-foreground">
          Component Marketplace
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Discover and install community components.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search components..."
            value={search}
          />
        </div>
        <Select
          onValueChange={(v) => setCategory(v as CategoryValue)}
          value={category}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                {cat.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          onValueChange={(v) => setSortBy(v as SortOption)}
          value={sortBy}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="downloads">Popular</SelectItem>
            <SelectItem value="rating">Top Rated</SelectItem>
            <SelectItem value="newest">Newest</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {componentsQuery.isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!componentsQuery.isLoading && components.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Package className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="mt-4 text-muted-foreground text-sm">
              No components found
            </p>
            <p className="mt-1 text-muted-foreground/60 text-xs">
              Try adjusting your search or filters.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Grid */}
      {!componentsQuery.isLoading && components.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {components.map((component) => (
            <ComponentCard
              authorName={component.author?.name ?? null}
              category={component.category}
              description={component.description}
              displayName={component.displayName}
              downloads={component.downloads}
              id={component.id}
              key={component.id}
              name={component.name}
              onInstall={() => handleInstall(component.id)}
              previewImageUrl={component.previewImageUrl}
              rating={component.rating}
              ratingCount={component.ratingCount}
              tags={component.tags}
            />
          ))}
        </div>
      )}

      {/* Load more */}
      {componentsQuery.data?.nextCursor && (
        <div className="flex justify-center">
          <Button
            disabled={componentsQuery.isFetching}
            onClick={() => componentsQuery.refetch()}
            variant="outline"
          >
            Load More
          </Button>
        </div>
      )}
    </div>
  );
}
