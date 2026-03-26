"use client";

import { Badge, Button, Card, CardContent } from "@prometheus/ui";
import { Download, Star } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

interface ComponentCardProps {
  authorName: string | null;
  category: string | null;
  description: string | null;
  displayName: string;
  downloads: number;
  id: string;
  name: string;
  onInstall?: () => void;
  previewImageUrl: string | null;
  rating: number;
  ratingCount: number;
  tags: string[] | null;
}

export function ComponentCard({
  id,
  displayName,
  description,
  authorName,
  rating,
  ratingCount,
  downloads,
  tags,
  previewImageUrl,
  category,
  onInstall,
}: ComponentCardProps) {
  return (
    <Card className="group flex flex-col transition-colors hover:border-muted-foreground/30">
      <CardContent className="flex flex-1 flex-col p-4">
        {/* Preview */}
        <div className="mb-3 flex h-32 items-center justify-center overflow-hidden rounded-md bg-muted">
          {previewImageUrl ? (
            // biome-ignore lint/performance/noImgElement: preview thumbnail
            <img
              alt={displayName}
              className="h-full w-full object-cover"
              height={128}
              src={previewImageUrl}
              width={256}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center font-bold text-2xl text-muted-foreground/30">
              {displayName[0]?.toUpperCase()}
            </div>
          )}
        </div>

        {/* Name and author */}
        <h3 className="font-semibold text-foreground text-sm">{displayName}</h3>
        <p className="text-muted-foreground text-xs">
          by {authorName ?? "Unknown"}
        </p>

        {/* Description */}
        {description && (
          <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
            {description}
          </p>
        )}

        {/* Rating and downloads */}
        <div className="mt-2 flex items-center gap-3 text-muted-foreground text-xs">
          <div className="flex items-center gap-1">
            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
            <span>{rating.toFixed(1)}</span>
            <span>({ratingCount})</span>
          </div>
          <div className="flex items-center gap-1">
            <Download className="h-3 w-3" />
            <span>{downloads.toLocaleString()}</span>
          </div>
        </div>

        {/* Tags */}
        {tags && tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {tags.slice(0, 3).map((tag) => (
              <Badge className="text-[10px]" key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
            {tags.length > 3 && (
              <Badge className="text-[10px]" variant="outline">
                +{tags.length - 3}
              </Badge>
            )}
          </div>
        )}

        {/* Category */}
        {category && (
          <Badge className="mt-2 w-fit text-[10px]" variant="outline">
            {category}
          </Badge>
        )}

        {/* Actions */}
        <div className="mt-auto flex gap-2 pt-3">
          <Button asChild className="flex-1" size="sm" variant="outline">
            <Link href={`/dashboard/marketplace/${id}` as Route}>View</Link>
          </Button>
          {onInstall && (
            <Button className="flex-1" onClick={onInstall} size="sm">
              Install
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
