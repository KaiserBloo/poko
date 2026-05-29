export type PlanName = "free" | "pro" | "team";

export type ProFeature =
  | "cloud.sync"
  | "history.watch"
  | "ai.translate"
  | "memory.server"
  | "analytics"
  | "marketplace"
  | "team.workspace";

export type LicensePlan = {
  name: PlanName;
  features: ProFeature[];
};

const FREE_PLAN: LicensePlan = {
  name: "free",
  features: [],
};

export const getPlan = (): LicensePlan => FREE_PLAN;

export const requireFeature = (feature: ProFeature): void => {
  const plan = getPlan();

  if (!plan.features.includes(feature)) {
    throw new Error(
      `The "${feature}" feature is part of poko Pro. Local init, sync, export, capture, history, and handoff stay free forever.`,
    );
  }
};
