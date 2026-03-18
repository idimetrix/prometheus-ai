import { describe, it, expect, beforeEach } from "vitest";
import { CreditService } from "../credits";

describe("CreditService", () => {
  let service: CreditService;

  beforeEach(() => {
    service = new CreditService();
  });

  it("should return default balance", async () => {
    const balance = await service.getBalance("org1");
    expect(balance.balance).toBe(50);
    expect(balance.reserved).toBe(0);
    expect(balance.available).toBe(50);
  });

  it("should reserve credits", async () => {
    const reservationId = await service.reserveCredits("org1", "task1", 10);
    expect(reservationId).toBeTruthy();
    expect(reservationId.startsWith("res_")).toBe(true);
  });

  it("should throw on insufficient credits", async () => {
    await expect(
      service.reserveCredits("org1", "task1", 100)
    ).rejects.toThrow("Insufficient credits");
  });
});
