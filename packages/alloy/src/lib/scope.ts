export const ServiceScope = {
  SINGLETON: "singleton",
  TRANSIENT: "transient",
} as const;

export type ServiceScope = (typeof ServiceScope)[keyof typeof ServiceScope];
