import { LogLevel } from "./log-level";

/**
 * Interface for output systems that handle log messages.
 */
export interface IOutput {
  /**
   * Write a log message at the specified level.
   * @param level - The log level
   * @param message - The message to log
   * @param args - Additional arguments to log
   */
  write(level: LogLevel, message: string, ...args: unknown[]): void;
}
