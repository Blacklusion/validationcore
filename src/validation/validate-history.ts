import {
  allChecksOK,
  calculateValidationLevel, extractLatitude, extractLongitude,
  logger, validateBpLocation
} from "../validationcore-database-scheme/common";
import { Guild } from "../validationcore-database-scheme/entity/Guild";
import * as config from "config";
import { Logger } from "tslog";
import { NodeHistory } from "../validationcore-database-scheme/entity/NodeHistory";
import { getConnection } from "typeorm";
import * as http from "../httpConnection/HttpRequest";
import { isURL } from "validator";
import { ValidationLevel } from "../validationcore-database-scheme/enum/ValidationLevel";
import { getChainsConfigItem } from "../validationcore-database-scheme/readConfig";

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
 * @param {unknown} location = location information as in bp.json
 */
export async function validateHistory(
  guild: Guild,
  chainId: string,
  endpointUrl: string,
  isSSL: boolean,
  location: unknown
): Promise<NodeHistory> {
  if (!endpointUrl) return undefined;

  // Counts how many requests have failed. If performance mode is enabled, future requests may not be performed, if to many requests already failed
  let failedRequestCounter = 0;

  // Create history object for database
  const database = getConnection(chainId);
  const history: NodeHistory = new NodeHistory();
  history.instance_id = config.get("general.instance_id");
  history.guild = guild.name;
  history.endpoint_url = endpointUrl;
  history.is_ssl = isSSL;


  if (getChainsConfigItem(chainId, "nodeHistory_location")) {
    history.location_ok = calculateValidationLevel(validateBpLocation(location), chainId, "nodeHistory_location_level");
    history.location_longitude = extractLongitude(location);
    history.location_latitude = extractLatitude(location);
  }

  // Check if valid EndpointUrl has been provided
  if (getChainsConfigItem(chainId, "nodeHistory_endpoint_url_ok")) {
    const endpointUrlOk = isURL(endpointUrl, {
      require_protocol: true,
    });
    history.endpoint_url_ok = calculateValidationLevel(endpointUrlOk, chainId, "nodeHistory_location_level");
  }

  /**
   * Test 1 get_transaction
   */
  if (getChainsConfigItem(chainId, "nodeHistory_get_transaction")) {
    await http
      .request(endpointUrl, "nodeHistory_get_transaction", chainId, failedRequestCounter)
      .then((response) => {
        /**
         * SSL Check
         */
        if (isSSL && getChainsConfigItem(chainId, "nodeHistory_ssl")) {
          http.evaluateSSL(endpointUrl, response.ok, response.errorType).then((response) => {
            history.ssl_ok = calculateValidationLevel(response.ok, chainId, "nodeHistory_ssl_level");
            history.ssl_errortype = response.errorType;
            if (history.ssl_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
          });
        }

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
      .request(endpointUrl, "nodeHistory_get_actions", chainId, failedRequestCounter)
      .then((response) => {
        history.get_actions_ms = response.elapsedTimeInMilliseconds;
        history.get_actions_errortype = response.errorType;
        history.get_actions_httpcode = response.httpCode;
        let errorCounterLocal = 0;

        // Request was not successful
        if (!response.ok || (response.ok && !response.isJson())) {
          historyActionsIncorrectMessage = response.errorMessage;
          history.get_actions_ok = calculateValidationLevel(
            false,
            chainId,
            "nodeHistory_get_actions_level"
          );
          return;
        }

        let expectedActionsCount = -1;
        try {
          expectedActionsCount = Math.abs(Number.parseInt(getChainsConfigItem(chainId, "$nodeHistory_transaction_offset")))
        } catch (e) {
          logger.error("Provided transaction_offset is not a number. The get_actions validation will have wrong results", e)
        }

        // Response does not contain correct number of actions
        let receivedActionsCount: number = null;
        if (Array.isArray(response.getDataItem(["actions"]))) {
          receivedActionsCount = response.getDataItem(["actions"]).length;
        }
        if (receivedActionsCount !== expectedActionsCount) {
          historyActionsIncorrectMessage += (historyActionsIncorrectMessage === "" ? "" : ", ") + "returned incorrect number of actions (expected " + expectedActionsCount + " got " + receivedActionsCount + ")";
          errorCounterLocal++;
        }

        // Response does not contain last_irreversible_block
        if (!response.getDataItem(["last_irreversible_block"])) {
          historyActionsIncorrectMessage += (historyActionsIncorrectMessage === "" ? "" : ", ") + "last irreversible block not provided";
          errorCounterLocal++;
        }

        // Response contains recent eosio.ram action
        if (getChainsConfigItem(chainId, "nodeHistory_get_actions_time_delta")) {
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
                (historyActionsIncorrectMessage === "" ? "" : ", ") +
                "last eosio.ram action older than " +
                config.get("validation.history_actions_block_time_delta") / 60000 +
                "min";
              errorCounterLocal++;
            }
          }

          // No block time was provided
          else {
            historyActionsIncorrectMessage += (historyActionsIncorrectMessage === "" ? "" : ", ") + "no block_time provided";
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
    history.get_actions_message = historyActionsIncorrectMessage === "" ? null : historyActionsIncorrectMessage;
    if (history.get_actions_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
  }

  /**
   * Test 3 get_key_accounts
   */
  if (getChainsConfigItem(chainId, "nodeHistory_get_key_accounts")) {
    await http
      .request(endpointUrl, "nodeHistory_get_key_accounts", chainId, failedRequestCounter)
      .then((response) => {
        const getKeyAccountsOk =
          response.ok && response.isJson() && response.getDataItem(["account_names"]) !== undefined;
        history.get_key_accounts_ok = calculateValidationLevel(
          getKeyAccountsOk,
          chainId,
          "nodeHistory_get_key_accounts_level"
        );

        history.get_key_accounts_ms = response.elapsedTimeInMilliseconds;
        history.get_key_accounts_errortype = response.errorType;
        history.get_key_accounts_httpcode = response.httpCode;

        if (history.get_key_accounts_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
      });
  }

  /**
   * Test 4 get_controlled_accounts
   */
  if (getChainsConfigItem(chainId, "nodeHistory_get_controlled_accounts")) {
    await http
      .request(endpointUrl, "nodeHistory_get_controlled_accounts", chainId, failedRequestCounter)
      .then((response) => {
        let getControlledAccountsOk =
          response.ok && response.isJson() && Array.isArray(response.getDataItem(["controlled_accounts"]));

        if (getControlledAccountsOk) {
          const arrayFromConfig = getChainsConfigItem(chainId, "$nodeHistory_controlled_account").split(",");
          getControlledAccountsOk = getControlledAccountsOk && arrayFromConfig.length === response.getDataItem(["controlled_accounts"]).length;

          arrayFromConfig.forEach(x => {
            getControlledAccountsOk = getControlledAccountsOk && response.getDataItem(["controlled_accounts"]).includes(x)
          })
        }
        history.get_controlled_accounts_ok = calculateValidationLevel(
          getControlledAccountsOk,
          chainId,
          "nodeHistory_get_controlled_accounts_level"
        );

        history.get_controlled_accounts_ms = response.elapsedTimeInMilliseconds;
        history.get_controlled_accounts_errortype = response.errorType;
        history.get_controlled_accounts_httpcode = response.httpCode;

        if (history.get_controlled_accounts_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
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
    ["nodeHistory_get_controlled_accounts", history.get_controlled_accounts_ok],
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
