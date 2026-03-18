import { z } from "zod";

export const purchaseCreditsSchema = z.object({
  amount: z.enum(["100", "500", "1000", "5000"]),
});

export type PurchaseCreditsInput = z.infer<typeof purchaseCreditsSchema>;
