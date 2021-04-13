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
  name: "Hist-Validation",
});

/**
 * Performs all validations of the History & Hyperion
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
   * 1. HISTORY
   */

  /**
   * Test 1.1 get_transaction
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
      history.history_transaction_ok = response.ok && response.isJson();
      history.history_transaction_ms = response.elapsedTimeInMilliseconds;
      history.history_transaction_message = response.getFormattedErrorMessage();

      if (!history.history_transaction_ok) failedRequestCounter++;
    });

  /**
   * Test 1.2 get_actions
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
      history.history_actions_ms = response.elapsedTimeInMilliseconds;
      let errorCounterLocal = 0;

      // Request was not successful
      if (!response.ok || (response.ok && !response.isJson())) {
        historyActionsIncorrectMessage = response.getFormattedErrorMessage();
        history.history_actions_ok = false;
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
      history.history_actions_ok = errorCounterLocal == 0;
    });
  history.history_actions_message = historyActionsIncorrectMessage;
  if (!history.history_actions_ok) failedRequestCounter++;

  /**
   * Test 1.3 get_key_accounts
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
      history.history_key_accounts_ms = response.elapsedTimeInMilliseconds;

      let historyKeyIncorrectMessage = ": invalid response format";
      if (!response.ok) {
        historyKeyIncorrectMessage = response.getFormattedErrorMessage();
        history.history_key_accounts_ok = false;
      } else {
        history.history_key_accounts_ok = response.isJson() && response.getDataItem(["account_names"]) !== undefined;
      }

      history.history_key_accounts_message = historyKeyIncorrectMessage;
      if (!history.history_key_accounts_ok) failedRequestCounter++;
    });

  /**
   * 2. HYPERION
   */
  // Reset failedRequestCounter for upcoming Hyperion tests
  failedRequestCounter = 0;

  /**
   * Test 2.1 Hyperion Health
   */
  await http.get(apiEndpoint, "/v2/health", http.evaluatePerformanceMode(failedRequestCounter)).then((response) => {
    history.hyperion_health_found = response.ok && response.isJson();
    history.hyperion_health_found_message = response.getFormattedErrorMessage();

    if (!history.hyperion_health_found) {
      failedRequestCounter++;
      return;
    }

    // Test 2.1.1 Health version
    history.hyperion_health_version_ok = response.getDataItem(["version"]) !== undefined;

    // Test 2.1.2 Health Host
    history.hyperion_health_host_ok = response.getDataItem(["host"]) !== undefined;

    // Test 2.1.3 Query Time
    let queryTimeIncorrectMessage = "";
    if (typeof response.getDataItem(["query_time_ms"]) === "number") {
      // Set status in database
      history.hyperion_health_query_time_ms = Math.round(response.getDataItem(["query_time_ms"]));
      history.hyperion_health_query_time_ok =
        response.getDataItem(["query_time_ms"]) < config.get("validation.hyperion_query_time_ms");

      // Assign message without any additional if, because message will only be sent if hyperion_health_query_time_ok is false
      queryTimeIncorrectMessage =
        "too high (" +
        history.hyperion_health_query_time_ms +
        "ms > " +
        config.get("validation.hyperion_query_time_ms") +
        "ms)";
    } else {
      queryTimeIncorrectMessage = "not provided";
      history.hyperion_health_query_time_ok = false;
    }
    history.hyperion_health_query_time_message = queryTimeIncorrectMessage;

    /**
     * Test 2.1.4 Features
     */
    let featureIncorrectMessage = "";
    if (!response.getDataItem(["features"])) {
      featureIncorrectMessage = ", features array is missing";
      history.hyperion_health_all_features_ok = false;
    } else {
      let errorCounterLocal = 0;
      // tables
      if (!response.getDataItem(["features", "tables"])) {
        featureIncorrectMessage = ", features.tables array missing";
      } else {
        // tables/proposals enabled
        if (response.getDataItem(["features", "tables", "proposals"]) == true) {
          history.hyperion_health_features_tables_proposals_on = true;
        } else {
          history.hyperion_health_features_tables_proposals_on = false;
          errorCounterLocal++;
          featureIncorrectMessage += ", tables/proposals is disabled";
        }

        // tables/accounts enabled
        if (response.getDataItem(["features", "tables", "accounts"]) == true) {
          history.hyperion_health_features_tables_accounts_on = true;
        } else {
          history.hyperion_health_features_tables_accounts_on = false;
          errorCounterLocal++;
          featureIncorrectMessage += ", tables/accounts is disabled";
        }

        // tables/voters enabled
        if (response.getDataItem(["features", "tables", "voters"]) == true) {
          history.hyperion_health_features_tables_voters_on = true;
        } else {
          history.hyperion_health_features_tables_voters_on = false;
          errorCounterLocal++;
          featureIncorrectMessage += ", tables/voters is disabled";
        }
      }

      // index_deltas enabled
      if (response.getDataItem(["features", "index_deltas"]) == true) {
        history.hyperion_health_features_index_deltas_on = true;
      } else {
        history.hyperion_health_features_index_deltas_on = false;
        errorCounterLocal++;
        featureIncorrectMessage += ", index_deltas is disabled";
      }

      // index_transfer_memo enabled
      if (response.getDataItem(["features", "index_transfer_memo"]) == true) {
        history.hyperion_health_features_index_transfer_memo_on = true;
      } else {
        history.hyperion_health_features_index_transfer_memo_on = false;
        errorCounterLocal++;
        featureIncorrectMessage += ", index_transfer_memo is disabled";
      }

      // index_all_deltas enabled
      if (response.getDataItem(["features", "index_all_deltas"]) == true) {
        history.hyperion_health_features_index_all_deltas_on = true;
      } else {
        history.hyperion_health_features_index_all_deltas_on = false;
        errorCounterLocal++;
        featureIncorrectMessage += ", index_all_deltas is disabled";
      }

      // deferred_trx disabled
      if (
        response.getDataItem(["features", "deferred_trx"]) == false ||
        response.getDataItem(["features", "deferred_trx"]) === undefined
      ) {
        history.hyperion_health_features_index_deferred_trx_off = true;
      } else {
        history.hyperion_health_features_index_deferred_trx_off = false;
        errorCounterLocal++;
        featureIncorrectMessage += ", deferred_trx is enabled";
      }

      // failed_trx disabled
      if (
        response.getDataItem(["features", "failed_trx"]) == false ||
        response.getDataItem(["features", "failed_trx"]) === undefined
      ) {
        history.hyperion_health_features_index_failed_trx_off = true;
      } else {
        history.hyperion_health_features_index_failed_trx_off = false;
        errorCounterLocal++;
        featureIncorrectMessage += ", failed_trx is enabled";
      }

      // resource_limits disabled
      if (
        response.getDataItem(["features", "resource_limits"]) == false ||
        response.getDataItem(["features", "resource_limits"]) === undefined
      ) {
        history.hyperion_health_features_resource_limits_off = true;
      } else {
        history.hyperion_health_features_resource_limits_off = false;
        errorCounterLocal++;
        featureIncorrectMessage += ", resource_limits is enabled";
      }

      // resource_usage disabled
      if (
        response.getDataItem(["features", "resource_usage"]) == false ||
        response.getDataItem(["features", "resource_usage"]) === undefined
      ) {
        history.hyperion_health_features_resource_usage_off = true;
      } else {
        history.hyperion_health_features_resource_usage_off = false;
        errorCounterLocal++;
        featureIncorrectMessage += ", resource_usage is enabled";
      }

      history.hyperion_health_all_features_ok = errorCounterLocal == 0;
    }

    history.hyperion_health_all_features_message = featureIncorrectMessage;

    /**
     * Test 2.1.5 Health of Services
     */
    // NodeosRPC
    let nodeosRpc;
    let rabbitmq;
    let elastic;
    if (Array.isArray(response.getDataItem(["health"]))) {
      nodeosRpc = response.getDataItem(["health"]).find((x) => x.service === "NodeosRPC");
      rabbitmq = response.getDataItem(["health"]).find((x) => x.service === "RabbitMq");
      elastic = response.getDataItem(["health"]).find((x) => x.service === "Elasticsearch");
    }

    let nodeosRpcIncorrectMessage = "not ok";
    if (
      nodeosRpc !== undefined &&
      nodeosRpc.status === "OK" &&
      nodeosRpc.service_data !== undefined &&
      nodeosRpc.service_data.time_offset !== undefined
    ) {
      history.hyperion_health_nodeosrpc_ok = true;

      // Check time offset
      if (nodeosRpc.service_data.time_offset < -500 || nodeosRpc.service_data.time_offset > 2000) {
        history.hyperion_health_nodeosrpc_ok = false;
        nodeosRpcIncorrectMessage +=
          ", time offset invalid (" + nodeosRpc.service_data.time_offset + ") must be between -500 and 2000";
      }

      // Check chainId
      if (nodeosRpc.service_data.chain_id !== chainId) {
        history.hyperion_health_nodeosrpc_ok = false;
        nodeosRpcIncorrectMessage += ", wrong chainId";
      }
    } else {
      history.hyperion_health_nodeosrpc_ok = false;
    }

    history.hyperion_health_nodeosrpc_message = nodeosRpcIncorrectMessage;

    // RabbitMq
    history.hyperion_health_rabbitmq_ok = rabbitmq !== undefined && rabbitmq.status === "OK";

    // Elastic
    history.hyperion_health_elastic_ok =
      elastic !== undefined &&
      elastic.status === "OK" &&
      elastic.service_data !== undefined &&
      elastic.service_data.active_shards === "100.0%";

    // Elastic - Total indexed blocks
    let indexBlocksIncorrectMessage = "";
    if (
      elastic !== undefined &&
      elastic.service_data !== undefined &&
      typeof elastic.service_data.last_indexed_block === "number" &&
      typeof elastic.service_data.total_indexed_blocks === "number"
    ) {
      const missingBlocks = elastic.service_data.last_indexed_block - elastic.service_data.total_indexed_blocks;
      history.hyperion_health_missing_blocks = missingBlocks;
      history.hyperion_health_total_indexed_blocks_ok =
        missingBlocks <= config.get("validation.hyperion_tolerated_missing_blocks");
      indexBlocksIncorrectMessage = "total indexed block != last indexed block (missing " + missingBlocks + " blocks)";
    } else {
      indexBlocksIncorrectMessage = "total indexed blocks field not provided in /v2/health";
      history.hyperion_health_total_indexed_blocks_ok = false;
    }

    history.hyperion_health_total_indexed_blocks_message = indexBlocksIncorrectMessage;
  });

  /**
   * Test 2.2 Hyperion get_transaction
   */
  await http
    .get(
      apiEndpoint,
      "/v2/history/get_transaction?id=" + config.get((isMainnet ? "mainnet" : "testnet") + ".history_test_transaction"),
      http.evaluatePerformanceMode(failedRequestCounter)
    )
    .then((response) => {
      history.hyperion_transaction_ok = response.ok;
      history.hyperion_transaction_ms = response.elapsedTimeInMilliseconds;
      history.hyperion_transaction_message = response.getFormattedErrorMessage();

      if (!history.hyperion_transaction_ok) failedRequestCounter++;
    });

  /**
   * Test 2.3 Hyperion get_actions
   */
  await http
    .get(apiEndpoint, "/v2/history/get_actions?limit=1", http.evaluatePerformanceMode(failedRequestCounter))
    .then((response) => {
      let hyperionActionsIncorrectMessage = "";

      history.hyperion_actions_ms = response.elapsedTimeInMilliseconds;

      if (!response.ok) {
        hyperionActionsIncorrectMessage = response.getFormattedErrorMessage();
        history.hyperion_actions_ok = false;
      }

      // block_time missing in last action
      else if (
        !(
          Array.isArray(response.getDataItem(["actions"])) &&
          response.getDataItem(["actions"]).length == 1 &&
          response.getDataItem(["actions"])[0]["@timestamp"]
        )
      ) {
        hyperionActionsIncorrectMessage = ", block_time not provided";
        history.hyperion_actions_ok = false;
      } else {
        let currentDate: number = Date.now();

        // Use time of http request if available in order to avoid server or validation time delay
        if (response.headers.get("date")) {
          currentDate = new Date(response.headers.get("date")).getTime();
        }
        // "+00:00" is necessary for defining date as UTC
        const timeDelta: number =
          currentDate - new Date(response.getDataItem(["actions"])[0]["@timestamp"] + "+00:00").getTime();

        // Hyperion up-to-date
        if (Math.abs(timeDelta) < 300000) {
          history.hyperion_actions_ok = true;
        } else {
          // Hyperion not up-to-date: last action is older than 5min
          history.hyperion_actions_ok = false;
          hyperionActionsIncorrectMessage += ", action is older than 5min";
        }
      }
      history.hyperion_actions_message = hyperionActionsIncorrectMessage;
      if (!history.hyperion_actions_ok) failedRequestCounter++;
    });

  /**
   * Test 2.4 Hyperion get_key_accounts
   */
  await http
    .post(
      apiEndpoint,
      "/v2/state/get_key_accounts",
      {
        public_key: config.get((isMainnet ? "mainnet" : "testnet") + ".history_test_public_key"),
      },
      http.evaluatePerformanceMode(failedRequestCounter)
    )
    .then((response) => {
      history.hyperion_key_accounts_ms = response.elapsedTimeInMilliseconds;
      history.hyperion_key_accounts_ok =
        response.ok && response.isJson() && response.getDataItem(["account_names"]) !== undefined;
      history.hyperion_key_accounts_message = response.getFormattedErrorMessage();

      if (!history.hyperion_key_accounts_ok) failedRequestCounter++;
    });

  /**
   * History Health
   */
  if (history.history_transaction_ok && history.history_actions_ok && history.history_key_accounts_ok) {
    history.history_all_checks_ok = true;
  } else {
    history.history_all_checks_ok = false;
  }

  /**
   * Hyperion Health
   */
  // failed_trx && deferred_trx && resource_limits && resource_usage are ignored
  if (
    history.hyperion_health_found &&
    history.hyperion_health_version_ok &&
    history.hyperion_health_host_ok &&
    history.hyperion_health_query_time_ok &&
    history.hyperion_health_features_tables_proposals_on &&
    history.hyperion_health_features_tables_accounts_on &&
    history.hyperion_health_features_tables_voters_on &&
    history.hyperion_health_features_index_deltas_on &&
    history.hyperion_health_features_index_transfer_memo_on &&
    history.hyperion_health_features_index_all_deltas_on &&
    history.hyperion_health_elastic_ok &&
    history.hyperion_health_rabbitmq_ok &&
    history.hyperion_health_nodeosrpc_ok &&
    history.hyperion_health_total_indexed_blocks_ok &&
    history.hyperion_transaction_ok &&
    history.hyperion_actions_ok &&
    history.hyperion_key_accounts_ok
  ) {
    history.hyperion_all_checks_ok = true;
  } else {
    history.hyperion_all_checks_ok = false;
  }

  /**
   * Total Health
   */
  history.all_checks_ok = history.history_all_checks_ok && history.hyperion_all_checks_ok;

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
