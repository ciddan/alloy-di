import { LogLevel } from "./log-level";
import type { IOutput } from "./output";

/**
 * Logger service that provides methods for logging at different levels.
 * Depends on an IOutput implementation injected via token.
 */
export class Logger {
  constructor(private output: IOutput) {}

  /**
   * Log a debug message.
   * @param message - The message to log
   * @param args - Additional arguments to log
   */
  debug(message: string, ...args: unknown[]): void {
    this.output.write(LogLevel.Debug, message, ...args);
  }

  /**
   * Log an info message.
   * @param message - The message to log
   * @param args - Additional arguments to log
   */
  info(message: string, ...args: unknown[]): void {
    this.output.write(LogLevel.Info, message, ...args);
  }

  /**
   * Log a warning message.
   * @param message - The message to log
   * @param args - Additional arguments to log
   */
  warn(message: string, ...args: unknown[]): void {
    this.output.write(LogLevel.Warn, message, ...args);
  }

  /**
   * Log an error message.
   * @param message - The message to log
   * @param args - Additional arguments to log
   */
  error(message: string, ...args: unknown[]): void {
    this.output.write(LogLevel.Error, message, ...args);
  }
}
