import { isLazy } from "./lazy";
import { Constructor, isConstructor, isToken } from "./types";

function describeDependency(value: unknown): string {
  if (isConstructor(value)) {
    return `constructor ${value.name || "<anonymous>"}`;
  }
  if (isToken(value)) {
    return `token(${value.description ?? value.id.toString()})`;
  }
  if (isLazy(value)) {
    return "Lazy(import)";
  }
  if (typeof value === "function") {
    return value.name || "<anonymous function>";
  }
  return String(value);
}

export class DependencyResolutionError extends Error {
  public readonly target: Constructor;
  public readonly resolutionStack: Constructor[];
  public readonly failedDependency?: unknown;

  constructor(
    message: string,
    params: {
      target: Constructor;
      resolutionStack: Constructor[];
      failedDependency?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, params.cause ? { cause: params.cause } : undefined);
    this.name = "DependencyResolutionError";
    this.target = params.target;
    this.resolutionStack = params.resolutionStack;
    this.failedDependency = params.failedDependency;
  }

  toDetailedString(): string {
    const stackPath = [
      ...this.resolutionStack.map((c) => c.name),
      this.target.name,
    ]
      .filter(Boolean)
      .join(" -> ");
    const dependencyInfo = this.failedDependency
      ? `\nFailed dependency: ${describeDependency(this.failedDependency)}`
      : "";
    return `${this.message}\nResolution path: ${stackPath}${dependencyInfo}`;
  }
}
