export const healthcareSkillPack = {
  id: "healthcare",
  name: "Healthcare",
  description: "HIPAA compliance, FHIR standards, PHI handling",
  domains: ["health", "medical", "clinical", "pharma"],
  knowledge: [
    "HIPAA: Protected Health Information (PHI) must be encrypted at rest and in transit",
    "Implement role-based access control (RBAC) for all PHI access",
    "Log all PHI access with user, timestamp, action, and data accessed",
    "FHIR R4 resources: Patient, Observation, Condition, MedicationRequest, Encounter",
    "Use HL7 FHIR JSON format for all clinical data exchange",
    "Implement consent management before sharing patient data",
    "Apply data minimization: only expose PHI fields needed for the operation",
    "Patient identifiers must never appear in logs or error messages",
    "Implement automatic session timeout after 15 minutes of inactivity",
    "Maintain audit trail for 6 years per HIPAA requirements",
  ],
  conventions: {
    naming: { patientFields: "Use FHIR resource naming conventions" },
    validation: "Validate all clinical codes against SNOMED CT / ICD-10",
    errorHandling: "Generic errors for unauthorized PHI access attempts",
  },
};
