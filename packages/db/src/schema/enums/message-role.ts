import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const messageRoleValues = ["user", "assistant", "system"] as const;
export type MessageRole = (typeof messageRoleValues)[number];
export const messageRoleEnum = pgEnum("message_role", messageRoleValues);
export const MessageRoleEnum = createEnumMap(messageRoleValues);
