import * as HttpRequest from "./httpConnection/HttpRequest";
import * as config from "config";
import { logger } from "./common";

export function evaluateMessage(
  oldValidation: boolean,
  newValidation: boolean,
  message: string,
  correctMessage: string,
  incorrectMessage: string
): string {
  if (newValidation == null) {
    logger.warn("NewValidation is null. This should not be the case. Check code. " + message + " " + correctMessage);
  }
  if ((oldValidation == null || oldValidation == true) && (newValidation == false || newValidation == null)) {
    return "‼️" + message + " " + incorrectMessage;
  } else if ((oldValidation == null || oldValidation == false) && newValidation == true) {
    return "✅" + message + " " + correctMessage;
  }
  return undefined;
}

export function sendMessageOrganization(guildName: string, isMainnet: boolean, message: string) {
  sendMessage(guildName, isMainnet, message, "/organization");
}

export function sendMessageApi(guildName: string, isMainnet: boolean, message: string) {
  sendMessage(guildName, isMainnet, message, "/api");
}

export function sendMessageHistory(guildName: string, isMainnet: boolean, message: string) {
  sendMessage(guildName, isMainnet, message, "/history");
}

export function sendMessageSeed(guildName: string, isMainnet: boolean, message: string) {
  sendMessage(guildName, isMainnet, message, "/seed");
}

function sendMessage(guildName: string, isMainnet: boolean, message: string, path: string) {
  // Abort if pager_mode is not enabled => Software is running only as validator
  if (!(config.has("general.pager_mode") ? config.get("general.pager_mode") : false)) return;

  const url: string = config.get("telegram.public_url");

  HttpRequest.post(
    url,
    path,
    '{"guild_name": "' + guildName + '", "isMainnet": ' + isMainnet + ', "message": "' + message + '"}'
  )
    .then((response) => {
      logger.debug(path + "\t Successfully sent message for " + guildName);
    })
    .catch((error) => {
      logger.fatal(
        "Telegram message for " +
          guildName +
          " could not be sent. All subscribers for that guild have not received messages!",
        error
      );
    });
}
