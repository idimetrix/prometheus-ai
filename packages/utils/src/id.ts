import { nanoid } from "nanoid";

export function generateId(prefix?: string, length = 21): string {
  const id = nanoid(length);
  return prefix ? `${prefix}_${id}` : id;
}
