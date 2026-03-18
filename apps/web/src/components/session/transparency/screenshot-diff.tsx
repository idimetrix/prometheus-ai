"use client";

import Image from "next/image";
import { useState } from "react";

interface ScreenshotDiffProps {
  afterUrl: string;
  beforeUrl: string;
  label?: string;
}

type DiffMode = "slider" | "onion-skin" | "side-by-side";

export function ScreenshotDiff({
  beforeUrl,
  afterUrl,
  label,
}: ScreenshotDiffProps) {
  const [mode, setMode] = useState<DiffMode>("slider");
  const [sliderPosition, setSliderPosition] = useState(50);
  const [opacity, setOpacity] = useState(0.5);

  return (
    <div className="flex flex-col gap-2">
      {label && <h4 className="font-medium text-sm text-zinc-300">{label}</h4>}

      <div className="flex gap-1 text-xs">
        {(["slider", "onion-skin", "side-by-side"] as const).map((m) => (
          <button
            className={`rounded px-2 py-1 ${
              mode === m
                ? "bg-indigo-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
            key={m}
            onClick={() => setMode(m)}
            type="button"
          >
            {m.replace("-", " ")}
          </button>
        ))}
      </div>

      {mode === "slider" && (
        <div className="relative overflow-hidden rounded border border-zinc-700">
          <Image
            alt="After"
            className="block w-full"
            height={600}
            src={afterUrl}
            unoptimized
            width={800}
          />
          <div
            className="absolute inset-0 overflow-hidden"
            style={{ width: `${sliderPosition}%` }}
          >
            <Image
              alt="Before"
              className="block w-full"
              height={600}
              src={beforeUrl}
              unoptimized
              width={800}
            />
          </div>
          <input
            className="absolute inset-x-0 bottom-2 mx-4"
            max={100}
            min={0}
            onChange={(e) => setSliderPosition(Number(e.target.value))}
            type="range"
            value={sliderPosition}
          />
          <div className="absolute top-2 left-2 rounded bg-black/60 px-2 py-0.5 text-white text-xs">
            Before
          </div>
          <div className="absolute top-2 right-2 rounded bg-black/60 px-2 py-0.5 text-white text-xs">
            After
          </div>
        </div>
      )}

      {mode === "onion-skin" && (
        <div className="relative overflow-hidden rounded border border-zinc-700">
          <Image
            alt="Before"
            className="block w-full"
            height={600}
            src={beforeUrl}
            unoptimized
            width={800}
          />
          <Image
            alt="After"
            className="absolute inset-0 block w-full"
            height={600}
            src={afterUrl}
            style={{ opacity }}
            unoptimized
            width={800}
          />
          <div className="absolute right-4 bottom-2 left-4">
            <input
              className="w-full"
              max={100}
              min={0}
              onChange={(e) => setOpacity(Number(e.target.value) / 100)}
              type="range"
              value={opacity * 100}
            />
            <div className="mt-1 text-center text-white/80 text-xs">
              Opacity: {Math.round(opacity * 100)}%
            </div>
          </div>
        </div>
      )}

      {mode === "side-by-side" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-xs text-zinc-500">Before</div>
            <Image
              alt="Before"
              className="rounded border border-zinc-700"
              height={600}
              src={beforeUrl}
              unoptimized
              width={800}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-zinc-500">After</div>
            <Image
              alt="After"
              className="rounded border border-zinc-700"
              height={600}
              src={afterUrl}
              unoptimized
              width={800}
            />
          </div>
        </div>
      )}
    </div>
  );
}
