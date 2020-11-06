import { logger } from "./common";

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
