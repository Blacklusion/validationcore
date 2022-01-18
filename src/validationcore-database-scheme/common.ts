import { Logger } from "tslog";
import * as config from "config";
import { ValidationLevel } from "./enum/ValidationLevel";
import { getChainsConfigItem } from "./readConfig";

/**
 * Logger used by all files
 */
export const logger: Logger = new Logger({
  name: "General",
  minLevel: config.has("general.logging_level") ? config.get("general.logging_level") : "info",
  displayLoggerName: false,
  displayFilePath: "hidden",
});

/**
 * Verifies a location field used by the bp.json schema
 * Do NOT use for location verification of on chain producer information
 * @param {object} location = json formatted object in the following schema: "name", "country", "latitude", "longitude"
 * @return {boolean} = is true if all location checks have passed
 */
export function validateBpLocation(location: any): boolean {
  let successfulLocationTests = 0;

  // Name
  try {
    if (RegExp(".+").test(location["name"])) {
      successfulLocationTests++;
    } else {
      logger.debug("FALSE \t Invalid location name");
    }
    // Country: Should be two digit upper case country code
    if (RegExp("[A-Z]{2}").test(location["country"]) && location["country"].length == 2) {
      successfulLocationTests++;
    } else {
      logger.debug("FALSE \t Invalid Country code. Should be two digit country code and upper case.");
    }
    // Latitude: should be between -90 and 90
    if (Math.abs(Number.parseFloat(location["latitude"])) <= 90) {
      successfulLocationTests++;
    } else {
      logger.debug("FALSE \t Invalid location latitude out of range");
    }
    // Longitude: should be between -180 and 180
    if (Math.abs(Number.parseFloat(location["longitude"])) <= 180) {
      successfulLocationTests++;
    } else {
      logger.debug("FALSE \t Invalid location longitude");
    }
    if (Number.parseFloat(location["longitude"]) == 0 && Number.parseFloat(location["latitude"]) == 0) {
      logger.debug("FALSE \t Your location would be in the atlantic ocean ;-)");
      return false;
    }
  } catch {
    return false;
  }

  return successfulLocationTests == 4;
}

/**
 * Extracts latitude from bp.json location object
 * @param {any} location = as in bp.json
 */
export function extractLatitude(location: any): number | null {
  try {
    return +Math.max(Math.min(Number.parseFloat(location["latitude"]), 90), -90).toFixed(6);
  } catch {
    return null;
  }
}

/**
 * Extracts longitude from bp.json location object
 * @param {any} location = as in bp.json
 */
export function extractLongitude(location: any): number | null {
  try {
    return +Math.max(Math.min(Number.parseFloat(location["longitude"]), 180), -180).toFixed(6);
  } catch {
    return null;
  }
}


// todo: check why needed
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
 * Waits specified amount of ms before returning from function
 * @param ms = amount of ms to wait
 */
export function sleep(ms: number) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}
