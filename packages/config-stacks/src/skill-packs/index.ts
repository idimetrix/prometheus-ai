export { aiMlSkillPack } from "./ai-ml";
export { devopsSkillPack } from "./devops";
export { fintechSkillPack } from "./fintech";
export { healthcareSkillPack } from "./healthcare";

export const SKILL_PACKS = {
  fintech: () => import("./fintech").then((m) => m.fintechSkillPack),
  healthcare: () => import("./healthcare").then((m) => m.healthcareSkillPack),
  devops: () => import("./devops").then((m) => m.devopsSkillPack),
  "ai-ml": () => import("./ai-ml").then((m) => m.aiMlSkillPack),
};
