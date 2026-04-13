export interface Status {
  stage: number;
  updatedAt: number;
}

export const STAGE_LABELS: Record<number, string> = {
  1: "Home",
  2: "Hospital",
  3: "Labor",
  4: "Delivery",
  5: "She's Here!",
};

export const STAGE_COUNT = 5;
