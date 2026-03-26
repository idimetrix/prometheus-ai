"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
  Textarea,
} from "@prometheus/ui";
import {
  ArrowLeft,
  ClipboardCopy,
  Download,
  Loader2,
  Star,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export default function MarketplaceComponentPage() {
  const params = useParams();
  const componentId = params.id as string;
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");

  const componentQuery = trpc.marketplace.get.useQuery({ componentId });
  const installMutation = trpc.marketplace.install.useMutation();
  const reviewMutation = trpc.marketplace.review.useMutation();

  const component = componentQuery.data;

  async function handleInstall() {
    try {
      const result = await installMutation.mutateAsync({ componentId });
      await navigator.clipboard.writeText(result.code);
      toast.success("Code copied to clipboard!");
    } catch {
      toast.error("Failed to install component");
    }
  }

  async function handleReview() {
    try {
      await reviewMutation.mutateAsync({
        componentId,
        rating: reviewRating,
        comment: reviewComment || undefined,
      });
      setReviewComment("");
      componentQuery.refetch();
      toast.success("Review submitted!");
    } catch {
      toast.error("Failed to submit review");
    }
  }

  if (componentQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!component) {
    return (
      <div className="space-y-4">
        <Button asChild size="sm" variant="ghost">
          <Link href={"/dashboard/marketplace" as Route}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
        <p className="text-muted-foreground">Component not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button asChild size="sm" variant="ghost">
        <Link href={"/dashboard/marketplace" as Route}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Marketplace
        </Link>
      </Button>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Header */}
          <div>
            <h1 className="font-bold text-2xl text-foreground">
              {component.displayName}
            </h1>
            <p className="mt-1 text-muted-foreground text-sm">
              by {component.author?.name ?? "Unknown"}
            </p>
            {component.description && (
              <p className="mt-3 text-foreground text-sm">
                {component.description}
              </p>
            )}
            <div className="mt-3 flex items-center gap-4 text-muted-foreground text-sm">
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                <span>{component.rating.toFixed(1)}</span>
                <span>({component.ratingCount} reviews)</span>
              </div>
              <div className="flex items-center gap-1">
                <Download className="h-4 w-4" />
                <span>{component.downloads.toLocaleString()} installs</span>
              </div>
            </div>
          </div>

          {/* Preview */}
          {component.previewImageUrl && (
            <Card>
              <CardContent className="p-4">
                {/* biome-ignore lint/correctness/useImageSize: dynamic marketplace image */}
                {/* biome-ignore lint/performance/noImgElement: external dynamic URL */}
                <img
                  alt={component.displayName}
                  className="w-full rounded-md"
                  src={component.previewImageUrl}
                />
              </CardContent>
            </Card>
          )}

          {/* Code */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Code</CardTitle>
              <Button onClick={handleInstall} size="sm" variant="outline">
                <ClipboardCopy className="mr-1 h-4 w-4" />
                Copy Code
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4">
                <code className="text-xs">{component.code}</code>
              </pre>
            </CardContent>
          </Card>

          {/* Reviews */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Reviews</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {component.reviews?.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  No reviews yet. Be the first!
                </p>
              )}
              {component.reviews?.map((review) => (
                <div className="space-y-1 border-b pb-3" key={review.id}>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          className={`h-3 w-3 ${
                            i < review.rating
                              ? "fill-yellow-400 text-yellow-400"
                              : "text-muted-foreground"
                          }`}
                          key={`star-${i.toString()}`}
                        />
                      ))}
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {new Date(review.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {review.comment && (
                    <p className="text-foreground text-sm">{review.comment}</p>
                  )}
                </div>
              ))}

              <Separator />

              {/* Submit review */}
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Write a Review</h4>
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <button
                      aria-label={`Rate ${(i + 1).toString()} stars`}
                      key={`rating-${i.toString()}`}
                      onClick={() => setReviewRating(i + 1)}
                      type="button"
                    >
                      <Star
                        className={`h-5 w-5 cursor-pointer ${
                          i < reviewRating
                            ? "fill-yellow-400 text-yellow-400"
                            : "text-muted-foreground"
                        }`}
                      />
                    </button>
                  ))}
                </div>
                <Textarea
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Share your thoughts about this component..."
                  rows={3}
                  value={reviewComment}
                />
                <Button
                  disabled={reviewMutation.isPending}
                  onClick={handleReview}
                  size="sm"
                >
                  {reviewMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Submit Review
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 p-4">
              <Button
                className="w-full"
                disabled={installMutation.isPending}
                onClick={handleInstall}
              >
                {installMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Install Component
              </Button>

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Version</span>
                  <span className="font-medium">{component.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Language</span>
                  <span className="font-medium">{component.language}</span>
                </div>
                {component.category && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Category</span>
                    <Badge variant="outline">{component.category}</Badge>
                  </div>
                )}
              </div>

              {/* Dependencies */}
              {component.dependencies && component.dependencies.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="mb-2 font-medium text-sm">Dependencies</h4>
                    <div className="flex flex-wrap gap-1">
                      {component.dependencies.map((dep) => (
                        <Badge
                          className="text-xs"
                          key={dep}
                          variant="secondary"
                        >
                          {dep}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Tags */}
              {component.tags && component.tags.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="mb-2 font-medium text-sm">Tags</h4>
                    <div className="flex flex-wrap gap-1">
                      {component.tags.map((tag) => (
                        <Badge className="text-xs" key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
