import { Logger } from "effect"

const severity: Record<string, string> = {
  TRACE: "DEBUG",
  DEBUG: "DEBUG",
  INFO: "INFO",
  WARN: "WARNING",
  WARNING: "WARNING",
  ERROR: "ERROR",
  FATAL: "CRITICAL"
}

/**
 * One JSON object per line with a `severity` field, which Cloud Logging maps
 * to log levels, so errors and warnings filter properly in the console.
 */
export const CloudLogger = Logger.layer([
  Logger.formatStructured.pipe(
    Logger.map((entry) =>
      JSON.stringify({
        severity: severity[entry.level] ?? "DEFAULT",
        message: entry.message,
        ...entry.annotations,
        ...(entry.cause === undefined ? {} : { cause: entry.cause }),
        timestamp: entry.timestamp
      })
    ),
    Logger.withConsoleLog
  )
])
