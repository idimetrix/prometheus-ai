import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:screenshot-comparator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComparisonResult {
  changedRegions: BoundingBox[];
  diffScore: number;
  totalPixels: number;
}

export interface BoundingBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// ScreenshotComparator
// ---------------------------------------------------------------------------

/**
 * Performs pixel-level comparisons between two Base64-encoded images.
 * Used for detecting visual differences in screenshot testing.
 */
export class ScreenshotComparator {
  /**
   * Compare two Base64-encoded images at the byte level.
   * Returns a diff score where 1 = identical, 0 = completely different.
   */
  compare(imageA: string, imageB: string): ComparisonResult {
    logger.info("Comparing screenshots");

    if (imageA === imageB) {
      return { diffScore: 1.0, totalPixels: imageA.length, changedRegions: [] };
    }

    const bufferA = Buffer.from(imageA, "base64");
    const bufferB = Buffer.from(imageB, "base64");

    const minLen = Math.min(bufferA.length, bufferB.length);
    const maxLen = Math.max(bufferA.length, bufferB.length);

    if (maxLen === 0) {
      return { diffScore: 1.0, totalPixels: 0, changedRegions: [] };
    }

    let matching = 0;
    for (let i = 0; i < minLen; i++) {
      if (bufferA[i] === bufferB[i]) {
        matching++;
      }
    }

    const diffScore = matching / maxLen;
    const changedRegions = this.getChangedRegions(imageA, imageB);

    return {
      diffScore,
      totalPixels: maxLen,
      changedRegions,
    };
  }

  /**
   * Identify rectangular regions that differ between the two images.
   * Uses a grid-based approach to cluster changed pixels into bounding boxes.
   */
  getChangedRegions(imageA: string, imageB: string): BoundingBox[] {
    const bufferA = Buffer.from(imageA, "base64");
    const bufferB = Buffer.from(imageB, "base64");

    if (bufferA.length === 0 && bufferB.length === 0) {
      return [];
    }

    // Estimate image dimensions from data length (assuming RGBA, 4 bytes/pixel)
    const bytesPerPixel = 4;
    const totalPixels =
      Math.max(bufferA.length, bufferB.length) / bytesPerPixel;
    const estimatedWidth = Math.ceil(Math.sqrt(totalPixels));
    const estimatedHeight = Math.ceil(
      totalPixels / Math.max(estimatedWidth, 1)
    );

    // Grid-based change detection: divide into 8x8 blocks
    const gridSize = 8;
    const colCount = Math.ceil(estimatedWidth / gridSize);
    const rowCount = Math.ceil(estimatedHeight / gridSize);

    const changedBlocks: BoundingBox[] = [];
    const minLen = Math.min(bufferA.length, bufferB.length);

    for (let row = 0; row < rowCount; row++) {
      for (let col = 0; col < colCount; col++) {
        const blockStart =
          (row * gridSize * estimatedWidth + col * gridSize) * bytesPerPixel;
        const blockEnd = Math.min(
          blockStart + gridSize * bytesPerPixel,
          minLen
        );

        let hasChange = false;
        for (let i = blockStart; i < blockEnd; i++) {
          if (bufferA[i] !== bufferB[i]) {
            hasChange = true;
            break;
          }
        }

        if (hasChange) {
          changedBlocks.push({
            x: col * gridSize,
            y: row * gridSize,
            width: gridSize,
            height: gridSize,
          });
        }
      }
    }

    return this.mergeAdjacentRegions(changedBlocks);
  }

  /**
   * Determine whether a diff score is acceptable given a threshold.
   */
  isAcceptable(diffScore: number, threshold = 0.98): boolean {
    return diffScore >= threshold;
  }

  // ---- Private helpers ----

  private mergeAdjacentRegions(regions: BoundingBox[]): BoundingBox[] {
    if (regions.length === 0) {
      return [];
    }

    // Simple merge: compute the bounding box of all changed blocks
    // A production version would use connected-component analysis
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const r of regions) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }

    return [
      {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      },
    ];
  }
}
