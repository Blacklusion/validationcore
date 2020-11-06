import * as HttpRequest from "./httpConnection/HttpRequest";
import * as config from "config";
import { logger } from "./common";
import { convertArrayToJson } from "./messageHandler";

export function sendMessageOrganization(guildName: string, isMainnet: boolean, messages: [string, boolean][]) {
  const headerMessage = "<b>" + (isMainnet ? "Mainnet" : "Testnet") + " Organization Results:</b> \\n";
  sendMessage(guildName, isMainnet, headerMessage, messages, "/organization");
}

export function sendMessageApi(
  guildName: string,
  isMainnet: boolean,
  apiEndpoint: string,
  messages: [string, boolean][]
) {
  const headerMessage = "<b>" + (isMainnet ? "Mainnet" : "Testnet") + " Api results for: " + apiEndpoint + "</b> \\n";
  sendMessage(guildName, isMainnet, headerMessage, messages, "/api");
}

export function sendMessageHistory(
  guildName: string,
  isMainnet: boolean,
  apiEndpoint: string,
  messages: [string, boolean][]
) {
  const headerMessage =
    "<b>" + (isMainnet ? "Mainnet" : "Testnet") + " History results for: " + apiEndpoint + "</b> \\n";
  sendMessage(guildName, isMainnet, headerMessage, messages, "/history");
}

export function sendMessageSeed(
  guildName: string,
  isMainnet: boolean,
  p2pEndpoint: string,
  messages: [string, boolean][]
) {
  const headerMessage = "<b>" + (isMainnet ? "Mainnet" : "Testnet") + " P2P results for: " + p2pEndpoint + "</b> \\n";
  sendMessage(guildName, isMainnet, headerMessage, messages, "/seed");
}

function sendMessage(
  guildName: string,
  isMainnet: boolean,
  headermessage: string,
  messages: [string, boolean][],
  path: string
) {
  // Abort if pager_mode is not enabled => Software is running only as validator
  if (!(config.has("general.pager_mode") ? config.get("general.pager_mode") : false)) return;

  // Read telegram service url from config
  const url: string = config.get("telegram.public_url");

  // Convert message Array to jsonArray
  const messagesJson = convertArrayToJson(messages);

  HttpRequest.post(
    url,
    path,
    '{"guild_name": "' +
      guildName +
      '", "isMainnet": ' +
      isMainnet +
      ', "headerMessage": ' +
      headermessage +
      ', "messages": "' +
      messagesJson +
      '"}'
  )
    .then((response) => {
      logger.debug(path + "\t Successfully sent message for " + guildName);
    })
    .catch((error) => {
      logger.fatal(
        "Telegram message for " +
          guildName +
          " could not be sent. All subscribers for that guild have not received a message!",
        error
      );
    });
}
