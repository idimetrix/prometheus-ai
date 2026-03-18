import { pgEnum } from "drizzle-orm/pg-core";
import { createEnumMap } from "./_utils";

export const creditReservationStatusValues = [
  "active",
  "committed",
  "released",
] as const;
export type CreditReservationStatus =
  (typeof creditReservationStatusValues)[number];
export const creditReservationStatusEnum = pgEnum(
  "credit_reservation_status",
  creditReservationStatusValues
);
export const CreditReservationStatusEnum = createEnumMap(
  creditReservationStatusValues
);
