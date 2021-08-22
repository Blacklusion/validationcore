import { Logger } from "tslog";
import * as config from "config";
import * as fs from "fs";
import { load } from "csv-load-sync";
import validator from "validator";
import { ValidationLevel } from "./enum/ValidationLevel";

/**
 * Logger used by all files
 */
export const logger: Logger = new Logger({
  name: "General",
  minLevel: config.has("general.logging_level") ? config.get("general.logging_level") : "info",
  displayLoggerName: true,
  displayFilePath: "hidden",
});

export function getChainsConfigItem(chainId: string, configItemKey: string) {
  const configItem = chainsConfig[chainId][configItemKey];
  if (configItem === undefined) logger.fatal("Invalid configItemKey: " + configItemKey + " Check config/chains.csv");

  return configItem;
}

export function getChainIdFromName(name: string) {
  for (let chainId in chainsConfig) {
    if (chainId !== undefined && chainsConfig[chainId].name === name) {
      return chainId;
    }
  }

  return null;
}

function calculateValidationLevel2(status: boolean, validationLevelInConfig: ValidationLevel) {
  if (status) return ValidationLevel.SUCCESS;
  else return validationLevelInConfig;
}

export function calculateValidationLevel(status: boolean, chainId: string, validationLevelKey: string) {
  const validationLevelInConfig = getChainsConfigItem(chainId, validationLevelKey);
  return calculateValidationLevel2(status, validationLevelInConfig);
}

export function combineValidationLevel(validations: ValidationLevel[]): ValidationLevel {
  let validationStatus = ValidationLevel.SUCCESS;

  validations.forEach((x) => {
    switch (x) {
      case ValidationLevel.WARN:
        if (validationStatus === ValidationLevel.SUCCESS) validationStatus = ValidationLevel.WARN;
        break;
      case ValidationLevel.ERROR:
        validationStatus = ValidationLevel.ERROR;
        break;
    }
  });

  return validationStatus;
}
export function allChecksOK(validations: [string, ValidationLevel][], chainId: string): ValidationLevel {
  let allChecksOk = ValidationLevel.SUCCESS;

  validations.forEach((x) => {
    const validationKey = x[0];
    const validationResult = x[1];
    try {
      if (getChainsConfigItem(chainId, validationKey)) {
        switch (validationResult) {
          case ValidationLevel.WARN:
            if (allChecksOk === ValidationLevel.SUCCESS) allChecksOk = ValidationLevel.WARN;
            break;
          case ValidationLevel.ERROR:
            allChecksOk = ValidationLevel.ERROR;
            break;
          case ValidationLevel.NULL:
            allChecksOk = ValidationLevel.ERROR;
            break;
        }
      }
    } catch (e) {
      logger.fatal(
        "Error during allChecksOk verification. This is likely an error in the config. Error for ValidationKey: " +
          validationKey +
          e
      );
    }
  });

  return allChecksOk;
}

/**
 * Reads all config files
 * @return {boolean} = true if no errors occurred
 */
export function readConfig(): boolean {
  // Check if config file with all necessary settings exists
  if (!checkConfig()) {
    logger.fatal("Not all settings were set.");
    return false;
  } else {
    logger.info("Valid config/local.toml was found!");
  }

  // Read json based config
  if (!readJsonConfigs()) {
    logger.fatal("JSON config files could not be read.");
    return false;
  } else {
    logger.info("Valid config/*.json files were found!");
  }

  // Read chains config
  if (!readChainsConfig()) {
    logger.fatal("config/chains.csv could not be read.");
    return false;
  } else {
    logger.info("Valid config/chains.csv was found!");
    logger.debug(chainsConfig);
  }

  return true;
}

/**
 * Checks if all necessary settings are provided in config/local.toml
 * @return {boolean} = true if no errors occurred
 */
function checkConfig(): boolean {
  let allVariablesAreSet = true;
  const settings = [
    ["general.name", "string"],
    ["general.pager_mode", "boolean"],
    // Logging_level must not be provided -> defaults to info

    // telegram urls are not declared as url, but as string, so they can be left blank
    ["telegram.public_url", "string"],
    ["telegram.private_url", "string"],

    ["validation.validation_round_interval", "number"],
    ["validation.validation_seed_offset", "number"],
    ["validation.request_retry_count", "number"],
    ["validation.request_retry_pause_ms", "number"],
    ["validation.request_timeout_ms", "number"],
    ["validation.producer_limit", "number"],
    ["validation.p2p_block_count", "number"],
    ["validation.p2p_ok_speed", "number"],
    ["validation.api_head_block_time_delta", "number"],
    ["validation.history_transaction_offset", "number"],
    ["validation.history_actions_block_time_delta", "number"],
    ["validation.hyperion_tolerated_missing_blocks", "number"],
    ["validation.hyperion_query_time_ms", "number"],
    ["validation.social_services", "array"],
    ["validation.performance_mode", "boolean"],
    ["validation.performance_mode_threshold", "number"],

    ["database.postgres_host", "string"],
    ["database.postgres_port", "number"],
    ["database.postgres_user", "string"],
    ["database.postgres_password", "string"],
  ];

  settings.forEach((setting) => {
    try {
      const configItem = config.get(setting[0]);
      if (setting[1] === "url") {
        if (
          !validator.isURL(configItem, {
            require_protocol: true,
          })
        ) {
          logger.error(setting[0] + " was provided. But it is not a valid url.");
          allVariablesAreSet = false;
        }
      } else if (
        (setting[1] === "array" && !Array.isArray(configItem)) ||
        (setting[1] !== "array" && !(typeof configItem === setting[1]))
      ) {
        logger.error(setting[0] + " was provided. But it is not of type " + setting[1]);
        allVariablesAreSet = false;
      }
    } catch (e) {
      logger.error(setting[0] + " was not provided!");
      allVariablesAreSet = false;
    }
  });

  return allVariablesAreSet;
}

/**
 * Reads JSON based config files in ./config
 * @return {boolean} = true if no errors occurred
 */
export function readJsonConfigs(): boolean {
  let error = false;
  validationConfig = {};

  // todo: check if the key already exists to prevent overwrites

  try {
    const validateApiConfig = JSON.parse(fs.readFileSync("config/validation-config/validate-api.json", "utf8"));
    for (let key in validateApiConfig) {
      validationConfig[key] = validateApiConfig[key];
    }
  } catch (e) {
    logger.error("Error while reading config/validation-config/validate-api.json: " + e);
    error = true;
  }

  try {
    const validateAtomicConfig = JSON.parse(fs.readFileSync("config/validation-config/validate-atomic.json", "utf8"));
    for (let key in validateAtomicConfig) {
      validationConfig[key] = validateAtomicConfig[key];
    }
  } catch (e) {
    logger.error("Error while reading config/validation-config/validate-atomic.json: " + e);
    error = true;
  }

  try {
    const validateHistoryConfig = JSON.parse(fs.readFileSync("config/validation-config/validate-history.json", "utf8"));
    for (let key in validateHistoryConfig) {
      validationConfig[key] = validateHistoryConfig[key];
    }
  } catch (e) {
    logger.error("Error while reading config/validation-config/validate-history.json: " + e);
    error = true;
  }

  try {
    const validateHyperionConfig = JSON.parse(
      fs.readFileSync("config/validation-config/validate-hyperion.json", "utf8")
    );
    for (let key in validateHyperionConfig) {
      validationConfig[key] = validateHyperionConfig[key];
    }
  } catch (e) {
    logger.error("Error while reading config/validation-config/validate-hyperion.json: " + e);
    error = true;
  }

  try {
    const validateWalletConfig = JSON.parse(fs.readFileSync("config/validation-config/validate-wallet.json", "utf8"));
    for (let key in validateWalletConfig) {
      validationConfig[key] = validateWalletConfig[key];
    }
  } catch (e) {
    logger.error("Error while reading config/validation-config/validate-wallet.json: " + e);
    error = true;
  }

  try {
    const versionsDir = fs.readdirSync("config/server-versions");
    serverVersionsConfig = {};
    versionsDir.forEach((x) => {
      try {
        const singleChainConfig = JSON.parse(fs.readFileSync("config/server-versions/" + x, "utf8"));
        for (const key in singleChainConfig) {
          serverVersionsConfig[key] = singleChainConfig[key];
        }
      } catch (e) {
        logger.error("Error while reading config/server-versions/" + x + ": " + e);
        error = true;
      }
    });
  } catch (e) {
    logger.error("Error while reading config/server-versions: " + e);
    error = true;
  }

  return !error;
}

/**
 * Reads the config/chains.csv
 * @return {boolean} = true if no errors occurred
 */
function readChainsConfig(): boolean {
  let error = false;
  const csvChainsConfig = {};
  try {
    const csv = load("config/chains.csv");
    csv.forEach((x) => {
      const chainConfig = {};

      for (const key in x) {
        if (key === undefined) {
          logger.warn("Setting in config/chains.csv is undefined. This should not be the case!");
        } else if (
          key.toLowerCase() === "chain_id" ||
          key.toLowerCase() === "name" ||
          key.toLowerCase() === "name_long" ||
          key.toLowerCase() === "logo" ||
          key.toLowerCase() === "api_endpoint"
        ) {
          chainConfig[key] = helperCheckStringOnNull(x[key]);
        } else if (key.toLowerCase().startsWith("$")) {
          chainConfig[key] = helperCheckStringOnNull(x[key]);
        } else if (key.toLowerCase().endsWith("_level")) {
          chainConfig[key] = helperConvertStringToValidationLevel(x[key]);
        } else {
          chainConfig[key] = helperConvertStringToBoolean(x[key]);
        }
      }

      csvChainsConfig[x.chain_id] = chainConfig;
    });
  } catch (e) {
    logger.error("Error during reading config/chains.csv: " + e);
    error = true;
  }
  chainsConfig = csvChainsConfig;
  logger.debug("chains.csv config loaded: ", chainsConfig);
  return !error;
}

/**
 * Converts a string to a boolean
 * @param {string} string = string that will be converted. Case will be ignored
 * @return {boolean}
 */
function helperConvertStringToBoolean(string: string): boolean {
  return string.toLowerCase() === "true";
}

/**
 * Returns the string as is, but if the string is "" or "null" null will be returned instead
 * @param {string} string = string that will be converted
 * @return {string} = either the original string or null
 */
function helperCheckStringOnNull(string: string): string | undefined {
  return string === "" || string.toLowerCase() === "null" ? undefined : string;
}

/**
 * Converts a Validationlevel in plain text to an enum based formatting
 * @param {string} string = name of the validationLevel
 * @return {ValidationLevel}
 */
function helperConvertStringToValidationLevel(string: string): ValidationLevel {
  switch (string.toLowerCase()) {
    case "info":
      return ValidationLevel.INFO;
    case "warn":
      return ValidationLevel.WARN;
    case "error":
      return ValidationLevel.ERROR;
    default:
      logger.error(
        "Unknown Validationlevel supplied in config: " +
          string +
          ". Check config. This may lead to unwanted sideeffects."
      );
      return ValidationLevel.ERROR;
  }
}

/**
 * Export configs for other parts of the program to access
 */
export let chainsConfig;
export let serverVersionsConfig;
export let validationConfig;
