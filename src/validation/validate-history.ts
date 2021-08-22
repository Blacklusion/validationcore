import {
  allChecksOK,
  calculateValidationLevel,
  getChainsConfigItem,
  logger,
} from "../validationcore-database-scheme/common";
import { Guild } from "../validationcore-database-scheme/entity/Guild";
import * as config from "config";
import { Logger } from "tslog";
import { NodeHistory } from "../validationcore-database-scheme/entity/NodeHistory";
import { getConnection } from "typeorm";
import * as http from "../httpConnection/HttpRequest";
import { isURL } from "validator";
import { ValidationLevel } from "../validationcore-database-scheme/enum/ValidationLevel";

/**
 * Logger Settings for NodeHistory
 */
const childLogger: Logger = logger.getChildLogger({
  name: "History-Validation",
});

/**
 * Performs all validations of the NodeHistory
 * @param {Guild} guild = guild for which the NodeHistory is validated (must be tracked in database)
 * @param {string} chainId = chainId of chain that is validated
 * @param {string} endpointUrl = url of the api node (http and https possible)
 * @param {boolean} isSSL = if true, it is also validated if TLS is working. Then the NodeApi will only be considered healthy, if all checks pass and if TLS is working
 * @param {boolean} locationOk = states if the location information found in the bp.json is valid
 */
export async function validateHistory(
  guild: Guild,
  chainId: string,
  endpointUrl: string,
  isSSL: boolean,
  locationOk: boolean
): Promise<NodeHistory> {
  if (!endpointUrl) return undefined;

  // Counts how many requests have failed. If performance mode is enabled, future requests may not be performed, if to many requests already failed
  let failedRequestCounter = 0;

  // Create history object for database
  const database = getConnection(chainId);
  const history: NodeHistory = new NodeHistory();
  history.guild = guild.name;
  history.endpoint_url = endpointUrl;

  if (getChainsConfigItem(chainId, "nodeHistory_location"))
    history.location_ok = calculateValidationLevel(locationOk, chainId, "nodeHistory_location_level");

  // Check if valid EndpointUrl has been provided
  if (getChainsConfigItem(chainId, "nodeHistory_endpoint_url_ok")) {
    const endpointUrlOk = isURL(endpointUrl, {
      require_protocol: true,
    });
    history.endpoint_url_ok = calculateValidationLevel(endpointUrlOk, chainId, "nodeHistory_location_level");
  }

  /**
   * SSL Check
   */
  history.is_ssl = isSSL;
  if (isSSL && getChainsConfigItem(chainId, "nodeHistory_ssl")) {
    http.evaluateSSL(endpointUrl).then((response) => {
      history.ssl_ok = calculateValidationLevel(response.ok, chainId, "nodeHistory_ssl_level");
      history.ssl_errortype = response.errorType;
      if (history.ssl_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
    });
  }

  /**
   * Test 1 get_transaction
   */
  if (getChainsConfigItem(chainId, "nodeHistory_get_transaction")) {
    await http
      .request(endpointUrl, "nodeHistory_get_transaction", chainId, http.evaluatePerformanceMode(failedRequestCounter))
      .then((response) => {
        const getTransactionOk = response.ok && response.isJson();
        history.get_transaction_ok = calculateValidationLevel(
          getTransactionOk,
          chainId,
          "nodeHistory_get_transaction_level"
        );
        history.get_transaction_ms = response.elapsedTimeInMilliseconds;
        history.get_transaction_errortype = response.errorType;
        history.get_transaction_httpcode = response.httpCode;

        if (history.get_transaction_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
      });
  }

  /**
   * Test 2 get_actions
   */
  if (getChainsConfigItem(chainId, "nodeHistory_get_actions")) {
    let historyActionsIncorrectMessage = "";
    await http
      .request(endpointUrl, "nodeHistory_get_actions", chainId, http.evaluatePerformanceMode(failedRequestCounter))
      .then((response) => {
        history.get_actions_ms = response.elapsedTimeInMilliseconds;
        history.get_transaction_errortype = response.errorType;
        history.get_transaction_httpcode = response.httpCode;
        let errorCounterLocal = 0;

        // Request was not successful
        if (!response.ok || (response.ok && !response.isJson())) {
          historyActionsIncorrectMessage = response.errorMessage;
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
        if (chainId) {
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
        history.get_actions_ok = calculateValidationLevel(
          errorCounterLocal === 0,
          chainId,
          "nodeHistory_get_actions_level"
        );
      });
    history.get_actions_message = historyActionsIncorrectMessage;
    if (history.get_actions_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
  }

  /**
   * Test 3 get_key_accounts
   */
  if (getChainsConfigItem(chainId, "nodeHistory_get_key_accounts")) {
    await http
      .request(endpointUrl, "nodeHistory_get_key_accounts", chainId, http.evaluatePerformanceMode(failedRequestCounter))
      .then((response) => {
        history.get_key_accounts_ms = response.elapsedTimeInMilliseconds;
        const getKeyAccountsOk =
          response.ok && response.isJson() && response.getDataItem(["account_names"]) !== undefined;
        history.get_key_accounts_ok = calculateValidationLevel(
          getKeyAccountsOk,
          chainId,
          "nodeHistory_get_key_accounts_level"
        );
        history.get_key_accounts_errortype = response.errorType;
        history.get_key_accounts_httpcode = response.httpCode;

        if (history.get_key_accounts_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
      });
  }

  /**
   * Set all checks ok
   */
  const validations: [string, ValidationLevel][] = [
    ["nodeHistory_location", history.location_ok],
    ["nodeHistory_endpoint_url_ok", history.endpoint_url_ok],
    ["nodeHistory_get_transaction", history.get_transaction_ok],
    ["nodeHistory_get_actions", history.get_actions_ok],
    ["nodeHistory_get_key_accounts", history.get_key_accounts_ok],
  ];

  if (isSSL) validations.push(["nodeHistory_ssl", history.ssl_ok]);

  history.all_checks_ok = allChecksOK(validations, chainId);

  /**
   * Store results in Database
   */
  try {
    await database.manager.save(history);
    childLogger.debug(
      "SAVED \t New NodeHistory validation to database for " +
        guild.name +
        " " +
        getChainsConfigItem(chainId, "name") +
        " to database"
    );
  } catch (error) {
    childLogger.fatal("Error while saving new NodeHistory validation to database", error);
  }

  return history;
}
