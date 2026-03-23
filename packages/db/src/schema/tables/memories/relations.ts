import { relations } from "drizzle-orm";
import { projects } from "../projects/projects";
import {
  agentMemories,
  episodicMemories,
  proceduralMemories,
} from "./memories";

export const agentMemoriesRelations = relations(agentMemories, ({ one }) => ({
  project: one(projects, {
    fields: [agentMemories.projectId],
    references: [projects.id],
  }),
}));

export const episodicMemoriesRelations = relations(
  episodicMemories,
  ({ one }) => ({
    project: one(projects, {
      fields: [episodicMemories.projectId],
      references: [projects.id],
    }),
  })
);

export const proceduralMemoriesRelations = relations(
  proceduralMemories,
  ({ one }) => ({
    project: one(projects, {
      fields: [proceduralMemories.projectId],
      references: [projects.id],
    }),
  })
);
