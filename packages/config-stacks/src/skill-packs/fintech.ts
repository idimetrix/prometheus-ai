export const fintechSkillPack = {
  id: "fintech",
  name: "Fintech",
  description: "PCI compliance, audit logging, financial calculations",
  domains: ["payments", "banking", "insurance", "trading"],
  knowledge: [
    "PCI DSS compliance: never store raw card numbers, use tokenization",
    "All financial calculations must use decimal/BigNumber, never floating point",
    "Every state-changing operation on financial data must be audit logged",
    "Implement idempotency keys for all payment operations",
    "Use database transactions for all balance modifications",
    "Apply double-entry bookkeeping for ledger operations",
    "Implement rate limiting on authentication endpoints",
    "Encrypt PII at rest using AES-256",
    "Log all admin actions with user ID, IP, timestamp, and action details",
    "Implement fraud detection hooks on high-value transactions",
  ],
  conventions: {
    naming: {
      amountFields: "Use 'amountCents' (integer) not 'amount' (float)",
    },
    validation: "Validate all monetary inputs as positive integers (cents)",
    errorHandling: "Never expose internal financial errors to clients",
  },
};
