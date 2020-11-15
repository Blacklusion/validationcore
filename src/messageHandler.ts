import { logger } from "./common";
import * as fs from "fs";
import * as config from "config";

/**
 * Determines if there as been a change between the current Validation and the previous Validation.
 * The Message string will be concatenated based on newValidation
 * @param {boolean} oldValidation = the state of the previous validation -> If true, the last validation was successful
 * @param {boolean} newValidation = the state of the current validation -> If true, the current validation was successful
 * @param {string} message = The beginning of the message, based on the evaluation of newValidation, either correctMessage (newValidation = true)
 *                           or IncorrectMessage (newValidation = false) will be concatenated to the end
 * @param {string} correctMessage = the message concatenated if newValidation is true and therefore the validation was successful
 * @param {string} incorrectMessage = the message concatenated if newValidation is false and therefore the validation was not successful
 * @return {[string, number]} = the formatted message and a number indicating the messageState (enum)
 */
export function evaluateMessage(
  oldValidation: boolean,
  newValidation: boolean,
  message: string,
  correctMessage: string,
  incorrectMessage: string
): [string, number] {

  // Check if new Validation was not assigned before calling method -> This would indicate a malfunctioning validation
  if (newValidation == null) {
    logger.warn("NewValidation is null. This should not be the case. Check code. Message: (" + message + " " + correctMessage + " / " + incorrectMessage + ")");
  }

  /**
   * Evaluate the MessageState
   * Determine if there has been a change from the new validation to the old validation and in which direction ((true to false) or (false to true))
   */
  let state: messageState;
  if (oldValidation) {
    // Old and new Validation are BOTH true -> Unchanged
    if (newValidation) {
      state = messageState.fromTrueToTrue;
    }
    // Old Validation was true and new Validation is false or undefined -> Changed
    else {
      state = messageState.fromTrueToFalse;
    }
  } else {
    // Old and new Validation are BOTH false or undefined -> Unchanged
    if (newValidation) {
      state = messageState.fromFalseToTrue
    }
    // Old Validation was false or undefined and new Validation is true -> Changed
    else {
      state = messageState.fromFalseToFalse;
    }
  }

  return [message + ((message && message.length > 0) ? " " : "") + ((state === messageState.fromTrueToTrue || state === messageState.fromFalseToTrue)? correctMessage : incorrectMessage), state]
}

/**
 * Converts array of messages to json
 * @param {[string, any][]} array = array containing all the validationMessages and the according messageState stored as a number
 * @param {string} endpoint = optional -> if provided an Endpoint Field will be provided at the top of the json
 * @return {any} = values of array formatted as json
 */
export function convertArrayToJson(array: [string, any][], endpoint: string = undefined): any {
  const json = {};

  // Add Endpoint at top if provided
  if (endpoint !== undefined)
    json["endpoint"] = endpoint;

  // Add all messages as provided in the array to json
  array.forEach((value) => {
    json[value[0]] = value[1]
  });

  return json;
}
/**
 * Writes a jsonFormatted file to disk
 * @param {string} guild = guild Name
 * @param {string} isMainnet = indicates if the json is for mainnet or testnet. Only used for creating a unique filename
 * @param {string} content = json Formatted content of the file
 */
export async function writeJsonToDisk(guild: string, isMainnet: boolean, content: string): Promise<void> {
  // Create filename with path
  const fileName = config.get("general.json_directory") + guild + "_" + (isMainnet ? "main" : "test") + ".json";

  // Write file to disk
  try {
    await fs.writeFileSync(fileName, content);
  } catch (error) {
    logger.error("Error while saving " + fileName, error);
  }
}

/**
 * Properly storing the message state is important, because the goal is to store all messages as json (regardless if true or false)
 * But at the same time the user will only be informed about messages that have changed (therefore no messages will be sent for TrueToTrue and FalseToFalse)
 */
export enum messageState{
  fromTrueToTrue,
  fromTrueToFalse,
  fromFalseToTrue,
  fromFalseToFalse
}
