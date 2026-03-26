"use client";

import { Button, Input } from "@prometheus/ui";
import { GitBranch, Globe, Loader2, Lock, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

type Provider = "github" | "gitlab" | "bitbucket";

interface RepoBrowserProps {
  onSelectRepo?: (repo: {
    fullName: string;
    name: string;
    defaultBranch: string;
    description: string | null;
    cloneUrl: string;
    isPrivate: boolean;
    language: string | null;
  }) => void;
  provider: Provider;
  selectedRepo?: string | null;
}

export function RepoBrowser({
  provider,
  onSelectRepo,
  selectedRepo,
}: RepoBrowserProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const reposQuery = trpc.integrations.listRepos.useQuery(
    {
      provider,
      search: debouncedSearch || undefined,
      page,
      perPage: 20,
      sort: "updated",
    },
    {
      retry: 2,
    }
  );

  const repos = reposQuery.data?.repos ?? [];

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search repositories..."
          value={search}
        />
      </div>

      {(() => {
        if (reposQuery.isLoading && !reposQuery.data) {
          return (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground text-sm">
                Loading repositories...
              </span>
            </div>
          );
        }
        if (repos.length === 0) {
          return (
            <div className="py-12 text-center text-muted-foreground text-sm">
              {debouncedSearch
                ? "No repositories match your search."
                : "No repositories found."}
            </div>
          );
        }
        return (
          <div className="max-h-[400px] space-y-1 overflow-y-auto">
            {repos.map((repo) => (
              <button
                className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                  selectedRepo === repo.fullName
                    ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                    : "border-transparent hover:border-border hover:bg-accent/50"
                }`}
                key={repo.fullName}
                onClick={() =>
                  onSelectRepo?.({
                    fullName: repo.fullName,
                    name: repo.name,
                    defaultBranch: repo.defaultBranch,
                    description: repo.description,
                    cloneUrl: repo.cloneUrl,
                    isPrivate: repo.private,
                    language: repo.language,
                  })
                }
                type="button"
              >
                {repo.private ? (
                  <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground text-sm">
                      {repo.fullName}
                    </span>
                    {repo.language && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                        {repo.language}
                      </span>
                    )}
                  </div>
                  {repo.description && (
                    <div className="mt-0.5 truncate text-muted-foreground text-xs">
                      {repo.description}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
                  <GitBranch className="h-3 w-3" />
                  {repo.defaultBranch}
                </div>
              </button>
            ))}
          </div>
        );
      })()}

      {repos.length > 0 && (
        <div className="flex items-center justify-between">
          <Button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            size="sm"
            variant="outline"
          >
            Previous
          </Button>
          <span className="text-muted-foreground text-xs">Page {page}</span>
          <Button
            disabled={repos.length < 20}
            onClick={() => setPage((p) => p + 1)}
            size="sm"
            variant="outline"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
