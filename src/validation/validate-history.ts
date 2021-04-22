import { logger } from "../common";
import { Guild } from "../database/entity/Guild";
import * as config from "config";
import { Logger } from "tslog";
import { History } from "../database/entity/History";
import { getConnection } from "typeorm";
import { HttpErrorType } from "../httpConnection/HttpErrorType";
import * as http from "../httpConnection/HttpRequest";

/**
 * Logger Settings for History
 */
const childLogger: Logger = logger.getChildLogger({
  name: "History-Validation",
});

/**
 * Performs all validations of the History
 * @param {Guild} guild = guild for which the History is validated (must be tracked in database)
 * @param {Boolean} isMainnet = only either testnet or mainnet is validated. If set to true, Mainnet will be validated
 * @param {string} apiEndpoint = url of the api node (http and https possible)
 * @param {boolean} isSsl = if true, it is also validated if TLS is working. Then the Api will only be considered healthy, if all checks pass and if TLS is working
 */
export async function validateAll(
  guild: Guild,
  isMainnet: boolean,
  apiEndpoint: string,
  isSsl: boolean
): Promise<History> {
  if (!apiEndpoint) return undefined;

  // Counts how many requests have failed. If performance mode is enabled, future requests may not be performed, if to many requests already failed
  let failedRequestCounter = 0;

  const chainId = isMainnet ? config.get("mainnet.chain_id") : config.get("testnet.chain_id");

  // Create history object for database
  const database = getConnection();
  const history: History = new History();
  history.guild = guild.name;
  history.api_endpoint = apiEndpoint;
  history.validation_is_mainnet = isMainnet;

  /**
   * SSL Check
   */
  history.is_ssl = isSsl;
  if (isSsl) {
    let sslMessage = "";
    if (!new RegExp("https://.+").test(apiEndpoint)) {
      history.ssl_ok = false;
      sslMessage = "not ok, no https url provided";
    } else {
      await http.get(apiEndpoint, "", 0).then((response) => {
        if (response.ok || (!response.ok && response.errorType === HttpErrorType.HTTP)) {
          history.ssl_ok = true;
        } else {
          history.ssl_ok = false;
          sslMessage = "not ok: " + response.getFormattedErrorMessage();
        }
      });
    }
    history.ssl_message = sslMessage;
    if (!history.ssl_ok) failedRequestCounter++;
  }

  /**
   * Test 1 get_transaction
   */
  await http
    .post(
      apiEndpoint,
      "/v1/history/get_transaction",
      {
        json: true,
        id: config.get((isMainnet ? "mainnet" : "testnet") + ".history_test_transaction"),
      },
      http.evaluatePerformanceMode(failedRequestCounter)
    )
    .then((response) => {
      history.transaction_ok = response.ok && response.isJson();
      history.transaction_ms = response.elapsedTimeInMilliseconds;
      history.transaction_message = response.getFormattedErrorMessage();

      if (!history.transaction_ok) failedRequestCounter++;
    });

  /**
   * Test 2 get_actions
   */
  let historyActionsIncorrectMessage = "";
  await http
    .post(
      apiEndpoint,
      "/v1/history/get_actions",
      {
        json: true,
        pos: -1,
        offset: config.get("validation.history_transaction_offset") * -1,
        account_name: "eosio.token",
      },
      http.evaluatePerformanceMode(failedRequestCounter)
    )
    .then((response) => {
      history.actions_ms = response.elapsedTimeInMilliseconds;
      let errorCounterLocal = 0;

      // Request was not successful
      if (!response.ok || (response.ok && !response.isJson())) {
        historyActionsIncorrectMessage = response.getFormattedErrorMessage();
        return;
      }

      // Response does not contain correct number of actions
      if (
        !(
          Array.isArray(response.getDataItem(["actions"])) &&
          response.getDataItem(["actions"]).length === config.get("validation.history_transaction_offset")
        )
      ) {
        historyActionsIncorrectMessage += ", returned incorrect number of actions";
        errorCounterLocal++;
      }

      // Response does not contain last_irreversible_block
      if (!response.getDataItem(["last_irreversible_block"])) {
        historyActionsIncorrectMessage += ", last irreversible block not provided";
        errorCounterLocal++;
      }

      // Response contains recent eosio.ram action
      if (isMainnet) {
        if (
          Array.isArray(response.getDataItem(["actions"])) &&
          response.getDataItem(["actions"]).length >= 1 &&
          response.getDataItem(["actions"])[0].block_time
        ) {
          let currentDate: number = Date.now();
          // Use time of http request if available in order to avoid server or validation time delay
          if (typeof response.headers.get("date") == "number") {
            currentDate = new Date(response.headers.get("date")).getTime();
          }
          // "+00:00" is necessary for defining date as UTC
          const timeDelta: number =
            new Date(response.getDataItem(["actions"])[0].block_time + "+00:00").getTime() - currentDate;

          // recent eosio.ram action is too old
          if (!(Math.abs(timeDelta) < config.get("validation.history_actions_block_time_delta"))) {
            historyActionsIncorrectMessage +=
              ", last eosio.ram action older than " +
              config.get("validation.history_actions_block_time_delta") / 60000 +
              "min";
            errorCounterLocal++;
          }
        }

        // No block time was provided
        else {
          historyActionsIncorrectMessage += ", no block_time provided";
          errorCounterLocal++;
        }
      }

      // Status ok if all checks are passed
      history.actions_ok = errorCounterLocal === 0;
    });
  history.actions_message = historyActionsIncorrectMessage;
  if (!history.actions_ok) failedRequestCounter++;

  /**
   * Test 3 get_key_accounts
   */
  await http
    .post(
      apiEndpoint,
      "/v1/history/get_key_accounts",
      {
        json: true,
        public_key: config.get((isMainnet ? "mainnet" : "testnet") + ".history_test_public_key"),
      },
      http.evaluatePerformanceMode(failedRequestCounter)
    )
    .then((response) => {
      history.key_accounts_ms = response.elapsedTimeInMilliseconds;

      let historyKeyIncorrectMessage = ": invalid response format";
      if (!response.ok) {
        historyKeyIncorrectMessage = response.getFormattedErrorMessage();
      } else {
        history.key_accounts_ok = response.isJson() && response.getDataItem(["account_names"]) !== undefined;
      }

      history.accounts_message = historyKeyIncorrectMessage;
      if (!history.key_accounts_ok) failedRequestCounter++;
    });

  /**
   * History Health
   */
  if (history.transaction_ok && history.actions_ok && history.key_accounts_ok) {
    history.all_checks_ok = true;
  } else {
    history.all_checks_ok = false;
  }


  /**
   * Store results in Database
   */
  try {
    await database.manager.save(history);
    childLogger.debug(
      "SAVED \t New History validation to database for " +
        guild.name +
        " " +
        (isMainnet ? "mainnet" : "testnet") +
        " to database"
    );
  } catch (error) {
    childLogger.fatal("Error while saving new History validation to database", error);
  }

  return history;
}