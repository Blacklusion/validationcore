import { logger } from "./common";
import * as fs from "fs"
import * as config from "config";

export function evaluateMessage(
  oldValidation: boolean,
  newValidation: boolean,
  message: string,
  correctMessage: string,
  incorrectMessage: string
): [string, boolean] {
  if (newValidation == null) {
    logger.warn("NewValidation is null. This should not be the case. Check code. " + message + " " + correctMessage);
  }
  if ((oldValidation == null || oldValidation == true) && (newValidation == false || newValidation == null)) {
    return [message + " " + incorrectMessage, false];
  } else if ((oldValidation == null || oldValidation == false) && newValidation == true) {
    return [message + " " + correctMessage, true];
  }
  return undefined;
}

/**
 * Converts array of messages to jsonLike formatted array
 * Note: The result is not a complete json file, the result is a single string that includes the array as
 * formatted as arrays in the json standard
 * @param array
 */
export function convertArrayToJson(array: [string, boolean][]): any {
  // Parse Array to jsonLike formatting
  let jsonString = "[";
  array.forEach((value, index, array) => {
    jsonString += "\n" + '"' + value[0] + '": ' + value[1];
    if (index !== array.length - 1) jsonString += ",";
  });
  jsonString += "]";

  return jsonString;
}

export function convertArrayToJsonWithHeader(header: string, array: [string, boolean][]) {

  let jsonString = '"' + header + '": ';
  jsonString += convertArrayToJson(array);
  return jsonString;
}

export async function writeJsonToDisk(guild: string, isMainnet: boolean, json: string) {

  // Create filename with path
  const fileName = config.get("general.json_directory") +  guild + "_" + (isMainnet ? "main" : "test") + ".json";

  // Write file to disk
  try {
    await fs.writeFileSync(fileName, json)
  } catch (error) {
    logger.error("Error while saving " + fileName, error);
  }
}
