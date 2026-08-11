type CallEEnvironment = Partial<Record<"CALLE_API_KEY" | "CALLE_LIVE_CALLS_ENABLED" | "CALLE_DEMO_MODE", string>>;

export function callEHealthStatus(environment: CallEEnvironment = {
  CALLE_API_KEY: process.env.CALLE_API_KEY,
  CALLE_LIVE_CALLS_ENABLED: process.env.CALLE_LIVE_CALLS_ENABLED,
  CALLE_DEMO_MODE: process.env.CALLE_DEMO_MODE,
}) {
  if (environment.CALLE_API_KEY && environment.CALLE_LIVE_CALLS_ENABLED === "true") return "live" as const;
  if (environment.CALLE_DEMO_MODE === "true") return "demo" as const;
  return "disabled" as const;
}
