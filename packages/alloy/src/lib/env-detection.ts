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

/**
 * Build-time-injected detection overrides.
 *
 * The Vite plugin emits a `setEnvDetectionOverrides({ isDev: ... })` call
 * into the generated container module so detection in plugin-driven setups
 * uses the bundler's authoritative mode instead of runtime sniffing.
 */
let injectedOverrides: EnvDetectionOverrides | undefined;

export function setEnvDetectionOverrides(
  overrides: EnvDetectionOverrides | undefined,
): void {
  injectedOverrides = overrides;
}

function readImportMetaEnvFromRuntime(): ImportMetaEnvShape | undefined {
  if (typeof import.meta === "undefined") {
    return undefined;
  }

  // @ts-expect-error -- `env` is bundler-provided and not part of ImportMeta
  const envValue: unknown = import.meta.env;
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
  try {
    const nodeEnv: unknown = process.env?.NODE_ENV;
    return typeof nodeEnv === "string" ? nodeEnv : undefined;
  } catch {
    return undefined;
  }
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
  const effective = overrides ?? injectedOverrides;
  if (typeof effective?.isDev === "boolean") {
    return effective.isDev;
  }

  const nodeEnv = getNodeEnv(effective);
  if (typeof nodeEnv === "string") {
    return nodeEnv !== "production";
  }

  const importMetaEnv = getImportMetaEnv(effective);
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
