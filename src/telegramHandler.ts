import * as config from "config";
import { logger } from "./common";
import { convertArrayToJson, messageState } from "./messageHandler";
import * as http from "./httpConnection/HttpRequest";

/**
 * Sends ORGANIZATION telegram messages for all subscribers of that guild
 * @param {string} guildName = on-chain name of the guild (as tracked in database)
 * @param {boolean} isMainnet = if true, the messages are relevant for mainnet and only users that subscribe to mainnet will receive the messages
 * @param {[string, number][]} messages =
 */
export function sendMessageOrganization(guildName: string, isMainnet: boolean, messages: [string, number][]): void {
  sendMessage(guildName, isMainnet, "", messages, "/organization");
}

/**
 * Sends API telegram messages for all subscribers of that guild
 * @param {string} guildName = on-chain name of the guild (as tracked in database)
 * @param {boolean} isMainnet = if true, the messages are relevant for mainnet and only users that subscribe to mainnet will receive the messages
 * @param {string} apiEndpoint = url of the Api Endpoint (will not be parsed, could technically be invalid url)
 * @param {[string, number][]} messages = all validationMessages as created in the validateAll() method. Messages will be filtered before sent
 */
export function sendMessageApi(
  guildName: string,
  isMainnet: boolean,
  apiEndpoint: string,
  messages: [string, number][]
): void {
  sendMessage(guildName, isMainnet, apiEndpoint, messages, "/api");
}

/**
 * Sends HISTORY telegram messages for all subscribers of that guild
 * @param {string} guildName = on-chain name of the guild (as tracked in database)
 * @param {boolean} isMainnet = if true, the messages are relevant for mainnet and only users that subscribe to mainnet will receive the messages
 * @param {string} apiEndpoint = url of the History Endpoint (will not be parsed, could technically be invalid url)
 * @param {[string, number][]} messages = all validationMessages as created in the validateAll() method. Messages will be filtered before sent
 */
export function sendMessageHistory(
  guildName: string,
  isMainnet: boolean,
  apiEndpoint: string,
  messages: [string, number][]
): void {
  sendMessage(guildName, isMainnet, apiEndpoint, messages, "/history");
}

/**
 * Sends SEED / P2P telegram messages for all subscribers of that guild
 * @param {string} guildName = on-chain name of the guild (as tracked in database)
 * @param {boolean} isMainnet = if true, the messages are relevant for mainnet and only users that subscribe to mainnet will receive the messages
 * @param {string} p2pEndpoint = url of the P2P Endpoint (will not be parsed, could technically be invalid url)
 * @param {[string, number][]} messages = all validationMessages as created in the validateAll() method. Messages will be filtered before sent
 */
export function sendMessageSeed(
  guildName: string,
  isMainnet: boolean,
  p2pEndpoint: string,
  messages: [string, number][]
): void {
  sendMessage(guildName, isMainnet, p2pEndpoint, messages, "/seed");
}

/**
 * Universal method to make an Api call for the pager-telegram-method that sends telegram messages to a list of subscribers
 * @param {string} guildName = on-chain name of the guild (as tracked in database)
 * @param {boolean} isMainnet = if true, the messages are relevant for mainnet and only users that subscribe to mainnet will receive the messages
 * @param {string} headerMessage = Text displayed at the top of the telegram message as bold text
 * @param {[string, number][]} messages = all validationMessages as created in the validateAll() method. Messages will be filtered before sent
 * @param {string} path = specifies which Api route will be called -> specifies if message is organization, api, history or seed
 */
function sendMessage(
  guildName: string,
  isMainnet: boolean,
  headerMessage: string,
  messages: [string, number][],
  path: string
): void {
  // Abort if pager_mode is not enabled => Software is running only as validator
  if (!(config.has("general.pager_mode") ? config.get("general.pager_mode") : false)) return;

  // Read telegram service url from config
  const url: string = config.get("telegram.public_url");

  // Filter messages -> Inform user only about changes, but not about reoccurring problems
  // New filtered array uses a simple true/false structure instead of the messageState structure
  const filteredMessages: [string, boolean][] = [];
  messages.forEach((message) => {
    if (message[1] === messageState.fromTrueToFalse || message[1] === messageState.fromFalseToTrue) {
      filteredMessages.push([message[0], message[1] === messageState.fromFalseToTrue]);
    }
  });

  if (filteredMessages.length === 0) return;

  // Convert message Array to jsonArray
  const messagesJson = convertArrayToJson(filteredMessages);

  // Send messages to Telegram service
  http
    .post(url, path, {
      guild_name: guildName,
      isMainnet: isMainnet,
      headerMessage: headerMessage,
      messages: messagesJson,
    })
    .then((response) => {
      if (response.ok) {
        logger.debug(path + "\t Successfully sent message for " + guildName);
      } else {
        logger.fatal(
          "Telegram message for " +
            guildName +
            " could not be sent. All subscribers for that guild have not received a message!",
          response.errorMessage
        );
      }
    });
}
