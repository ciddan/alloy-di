export type ImportMetaEnvShape = {
  MODE?: string;
  PROD?: boolean;
  NODE_ENV?: string;
  [key: string]: unknown;
};

export type EnvDetectionOverrides = {
  /**
   * Explicit import.meta.env replacement. Use `null` to force "no env" behavior.
   */
  importMetaEnv?: ImportMetaEnvShape | null;
  /**
   * Explicit NODE_ENV replacement. Use `null` to ignore process.env.
   */
  nodeEnv?: string | null;
  /**
   * Short-circuit the entire detection logic with a predetermined boolean.
   */
  isDev?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readImportMetaEnvFromRuntime(): ImportMetaEnvShape | undefined {
  if (typeof import.meta === "undefined") {
    return undefined;
  }

  const candidate: unknown = import.meta;
  if (!isRecord(candidate) || !("env" in candidate)) {
    return undefined;
  }

  const envValue = (candidate as { env?: unknown }).env;
  if (!isRecord(envValue)) {
    return undefined;
  }

  const env: ImportMetaEnvShape = {};
  if (typeof envValue.MODE === "string") {
    env.MODE = envValue.MODE;
  }
  if (typeof envValue.PROD === "boolean") {
    env.PROD = envValue.PROD;
  }
  if (typeof envValue.NODE_ENV === "string") {
    env.NODE_ENV = envValue.NODE_ENV;
  }
  return env;
}

function readProcessNodeEnv(): string | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }
  const nodeEnv = process.env?.NODE_ENV;
  return typeof nodeEnv === "string" ? nodeEnv : undefined;
}

export function getImportMetaEnv(
  overrides?: EnvDetectionOverrides,
): ImportMetaEnvShape | undefined {
  if (overrides?.importMetaEnv === null) {
    return undefined;
  }
  if (overrides?.importMetaEnv) {
    return overrides.importMetaEnv;
  }
  return readImportMetaEnvFromRuntime();
}

export function getNodeEnv(
  overrides?: EnvDetectionOverrides,
): string | undefined {
  if (typeof overrides?.nodeEnv === "string") {
    return overrides.nodeEnv;
  }
  if (overrides?.nodeEnv === null) {
    return undefined;
  }
  return readProcessNodeEnv();
}

export function isDevEnvironment(overrides?: EnvDetectionOverrides): boolean {
  if (typeof overrides?.isDev === "boolean") {
    return overrides.isDev;
  }

  const nodeEnv = getNodeEnv(overrides);
  if (typeof nodeEnv === "string") {
    return nodeEnv !== "production";
  }

  const importMetaEnv = getImportMetaEnv(overrides);
  if (typeof importMetaEnv?.PROD === "boolean") {
    return !importMetaEnv.PROD;
  }
  if (typeof importMetaEnv?.MODE === "string") {
    return importMetaEnv.MODE !== "production";
  }
  if (typeof importMetaEnv?.NODE_ENV === "string") {
    return importMetaEnv.NODE_ENV !== "production";
  }

  // Default to a development-like mode when no hints are available.
  return true;
}
