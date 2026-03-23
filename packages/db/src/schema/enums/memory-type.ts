import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const memoryTypeValues = [
  "semantic",
  "episodic",
  "procedural",
  "architectural",
  "convention",
] as const;
export type MemoryType = (typeof memoryTypeValues)[number];
export const memoryTypeEnum = pgEnum("memory_type", memoryTypeValues);
export const MemoryTypeEnum = createEnumMap(memoryTypeValues);
