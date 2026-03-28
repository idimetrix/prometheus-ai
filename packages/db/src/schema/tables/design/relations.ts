import { relations } from "drizzle-orm";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";
import { designToCodeJobs } from "./jobs";
import { designUploads } from "./uploads";

export const designUploadsRelations = relations(
  designUploads,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [designUploads.orgId],
      references: [organizations.id],
    }),
    project: one(projects, {
      fields: [designUploads.projectId],
      references: [projects.id],
    }),
    jobs: many(designToCodeJobs),
  })
);

export const designToCodeJobsRelations = relations(
  designToCodeJobs,
  ({ one }) => ({
    designUpload: one(designUploads, {
      fields: [designToCodeJobs.designUploadId],
      references: [designUploads.id],
    }),
  })
);
