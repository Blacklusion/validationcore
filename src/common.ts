import { Logger } from "tslog";
import * as config from "config";

/**
 * Logger used by all files
 */
export const logger: Logger = new Logger({
  name: "General",
  minLevel: config.has("general.logging_level") ? config.get("general.logging_level") : "info",
  displayLoggerName: true,
  displayFilePath: "hidden",
});
