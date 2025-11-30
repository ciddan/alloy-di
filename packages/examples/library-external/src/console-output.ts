import { IOutput } from "./output";
import { LogLevel } from "./log-level";

/**
 * Console-based output implementation that routes log messages
 * to the appropriate console method based on log level.
 */
export class ConsoleOutput implements IOutput {
  write(level: LogLevel, message: string, ...args: unknown[]): void {
    switch (level) {
      case LogLevel.Debug:
        console.debug(message, ...args);
        break;
      case LogLevel.Info:
        console.info(message, ...args);
        break;
      case LogLevel.Warn:
        console.warn(message, ...args);
        break;
      case LogLevel.Error:
        console.error(message, ...args);
        break;
    }
  }
}
