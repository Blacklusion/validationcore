import { logger } from "../common";
import { Guild } from "../database/entity/Guild";
import * as config from "config";
import { Logger } from "tslog";
import { getConnection } from "typeorm";
import { HttpErrorType } from "../httpConnection/HttpErrorType";
import * as http from "../httpConnection/HttpRequest";
import { NodeHyperion } from "../database/entity/NodeHyperion";

/**
 * Logger Settings for NodeHyperion
 */
const childLogger: Logger = logger.getChildLogger({
  name: "Hyperion-Validation",
});

/**
 * Performs all validations of the NodeHyperion
 * @param {Guild} guild = guild for which the NodeHyperion is validated (must be tracked in database)
 * @param {Boolean} isMainnet = only either testnet or mainnet is validated. If set to true, Mainnet will be validated
 * @param {string} apiEndpoint = url of the api node (http and https possible)
 * @param {boolean} isSsl = if true, it is also validated if TLS is working. Then the NodeApi will only be considered healthy, if all checks pass and if TLS is working
 */
export async function validateAll(
  guild: Guild,
  isMainnet: boolean,
  apiEndpoint: string,
  isSsl: boolean
): Promise<NodeHyperion> {
  if (!apiEndpoint) return undefined;

  // Counts how many requests have failed. If performance mode is enabled, future requests may not be performed, if to many requests already failed
  let failedRequestCounter = 0;

  const chainId = isMainnet ? config.get("mainnet.chain_id") : config.get("testnet.chain_id");

  // Create hyperion object for database
  const database = getConnection();
  const hyperion: NodeHyperion = new NodeHyperion();
  hyperion.guild = guild.name;
  hyperion.api_endpoint = apiEndpoint;
  hyperion.validation_is_mainnet = isMainnet;

  /**
   * SSL Check
   */
  hyperion.is_ssl = isSsl;
  if (isSsl) {
    let sslMessage = "";
    if (!new RegExp("https://.+").test(apiEndpoint)) {
      hyperion.ssl_ok = false;
      sslMessage = "not ok, no https url provided";
    } else {
      await http.get(apiEndpoint, "", 0).then((response) => {
        if (response.ok || (!response.ok && response.errorType === HttpErrorType.HTTP)) {
          hyperion.ssl_ok = true;
        } else {
          hyperion.ssl_ok = false;
          sslMessage = "not ok: " + response.getFormattedErrorMessage();
        }
      });
    }
    hyperion.ssl_message = sslMessage;
    if (!hyperion.ssl_ok) failedRequestCounter++;
  }

  /**
   * Test 1 NodeHyperion Health
   */
  await http.get(apiEndpoint, "/v2/health", http.evaluatePerformanceMode(failedRequestCounter)).then((response) => {
    hyperion.health_found = response.ok && response.isJson();
    hyperion.health_found_message = response.getFormattedErrorMessage();

    if (!hyperion.health_found) {
      failedRequestCounter++;
      return;
    }

    // Test 1.1 Health version
    hyperion.health_version_ok = response.getDataItem(["version"]) !== undefined;

    // Test 1.2 Health Host
    hyperion.health_host_ok = response.getDataItem(["host"]) !== undefined;

    // Test 1.3 Query Time
    let queryTimeIncorrectMessage = "";
    if (typeof response.getDataItem(["query_time_ms"]) === "number") {
      // Set status in database
      hyperion.health_query_time_ms = Math.round(response.getDataItem(["query_time_ms"]));
      hyperion.health_query_time_ok =
        response.getDataItem(["query_time_ms"]) < config.get("validation.hyperion_query_time_ms");

      // Assign message without any additional if, because message will only be sent if hyperion_health_query_time_ok is false
      queryTimeIncorrectMessage =
        "too high (" +
        hyperion.health_query_time_ms +
        "ms > " +
        config.get("validation.hyperion_query_time_ms") +
        "ms)";
    } else {
      queryTimeIncorrectMessage = "not provided";
    }
    hyperion.health_query_time_message = queryTimeIncorrectMessage;

    /**
     * Test 1.4 Features
     */
    let featureIncorrectMessage = "";
    if (!response.getDataItem(["features"])) {
      featureIncorrectMessage = ", features array is missing";
    } else {
      let errorCounterLocal = 0;
      // tables
      if (!response.getDataItem(["features", "tables"])) {
        featureIncorrectMessage = ", features.tables array missing";
      } else {
        // tables/proposals enabled
        if (response.getDataItem(["features", "tables", "proposals"]) == true) {
          hyperion.health_features_tables_proposals_on = true;
        } else {
          errorCounterLocal++;
          featureIncorrectMessage += ", tables/proposals is disabled";
        }

        // tables/accounts enabled
        if (response.getDataItem(["features", "tables", "accounts"]) == true) {
          hyperion.health_features_tables_accounts_on = true;
        } else {
          errorCounterLocal++;
          featureIncorrectMessage += ", tables/accounts is disabled";
        }

        // tables/voters enabled
        if (response.getDataItem(["features", "tables", "voters"]) == true) {
          hyperion.health_features_tables_voters_on = true;
        } else {
          errorCounterLocal++;
          featureIncorrectMessage += ", tables/voters is disabled";
        }
      }

      // index_deltas enabled
      if (response.getDataItem(["features", "index_deltas"]) == true) {
        hyperion.health_features_index_deltas_on = true;
      } else {
        errorCounterLocal++;
        featureIncorrectMessage += ", index_deltas is disabled";
      }

      // index_transfer_memo enabled
      if (response.getDataItem(["features", "index_transfer_memo"]) == true) {
        hyperion.health_features_index_transfer_memo_on = true;
      } else {
        errorCounterLocal++;
        featureIncorrectMessage += ", index_transfer_memo is disabled";
      }

      // index_all_deltas enabled
      if (response.getDataItem(["features", "index_all_deltas"]) == true) {
        hyperion.health_features_index_all_deltas_on = true;
      } else {
        errorCounterLocal++;
        featureIncorrectMessage += ", index_all_deltas is disabled";
      }

      // deferred_trx disabled
      if (
        response.getDataItem(["features", "deferred_trx"]) == false ||
        response.getDataItem(["features", "deferred_trx"]) === undefined
      ) {
        hyperion.health_features_index_deferred_trx_off = true;
      } else {
        errorCounterLocal++;
        featureIncorrectMessage += ", deferred_trx is enabled";
      }

      // failed_trx disabled
      if (
        response.getDataItem(["features", "failed_trx"]) == false ||
        response.getDataItem(["features", "failed_trx"]) === undefined
      ) {
        hyperion.health_features_index_failed_trx_off = true;
      } else {
        errorCounterLocal++;
        featureIncorrectMessage += ", failed_trx is enabled";
      }

      // resource_limits disabled
      if (
        response.getDataItem(["features", "resource_limits"]) == false ||
        response.getDataItem(["features", "resource_limits"]) === undefined
      ) {
        hyperion.health_features_resource_limits_off = true;
      } else {
        errorCounterLocal++;
        featureIncorrectMessage += ", resource_limits is enabled";
      }

      // resource_usage disabled
      if (
        response.getDataItem(["features", "resource_usage"]) == false ||
        response.getDataItem(["features", "resource_usage"]) === undefined
      ) {
        hyperion.health_features_resource_usage_off = true;
      } else {
        errorCounterLocal++;
        featureIncorrectMessage += ", resource_usage is enabled";
      }

      hyperion.health_all_features_ok = errorCounterLocal == 0;
    }

    hyperion.health_all_features_message = featureIncorrectMessage;

    /**
     * Test 1.5 Health of Services
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
      hyperion.health_nodeosrpc_ok = true;

      // Check time offset
      if (nodeosRpc.service_data.time_offset < -500 || nodeosRpc.service_data.time_offset > 2000) {
        nodeosRpcIncorrectMessage +=
          ", time offset invalid (" + nodeosRpc.service_data.time_offset + ") must be between -500 and 2000";
      }

      // Check chainId
      if (nodeosRpc.service_data.chain_id !== chainId) {
        nodeosRpcIncorrectMessage += ", wrong chainId";
      }
    }

    hyperion.health_nodeosrpc_message = nodeosRpcIncorrectMessage;

    // RabbitMq
    hyperion.health_rabbitmq_ok = rabbitmq !== undefined && rabbitmq.status === "OK";

    // Elastic
    hyperion.health_elastic_ok =
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
      hyperion.health_missing_blocks = missingBlocks;
      hyperion.health_total_indexed_blocks_ok =
        missingBlocks <= config.get("validation.hyperion_tolerated_missing_blocks");
      indexBlocksIncorrectMessage = "total indexed block != last indexed block (missing " + missingBlocks + " blocks)";
    } else {
      indexBlocksIncorrectMessage = "total indexed blocks field not provided in /v2/health";
    }

    hyperion.health_total_indexed_blocks_message = indexBlocksIncorrectMessage;
  });

  /**
   * Test 2 NodeHyperion get_transaction
   */
  await http
    .get(
      apiEndpoint,
      "/v2/hyperion/get_transaction?id=" + config.get((isMainnet ? "mainnet" : "testnet") + ".history_test_transaction"),
      http.evaluatePerformanceMode(failedRequestCounter)
    )
    .then((response) => {
      hyperion.transaction_ok = response.ok;
      hyperion.transaction_ms = response.elapsedTimeInMilliseconds;
      hyperion.transaction_message = response.getFormattedErrorMessage();

      if (!hyperion.transaction_ok) failedRequestCounter++;
    });

  /**
   * Test 3 NodeHyperion get_actions
   */
  await http
    .get(apiEndpoint, "/v2/hyperion/get_actions?limit=1", http.evaluatePerformanceMode(failedRequestCounter))
    .then((response) => {
      let hyperionActionsIncorrectMessage = "";

      hyperion.actions_ms = response.elapsedTimeInMilliseconds;

      if (!response.ok) {
        hyperionActionsIncorrectMessage = response.getFormattedErrorMessage();
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
      } else {
        let currentDate: number = Date.now();

        // Use time of http request if available in order to avoid server or validation time delay
        if (response.headers.get("date")) {
          currentDate = new Date(response.headers.get("date")).getTime();
        }
        // "+00:00" is necessary for defining date as UTC
        const timeDelta: number =
          currentDate - new Date(response.getDataItem(["actions"])[0]["@timestamp"] + "+00:00").getTime();

        // NodeHyperion up-to-date
        if (Math.abs(timeDelta) < 300000) {
          hyperion.actions_ok = true;
        } else {
          // NodeHyperion not up-to-date: last action is older than 5min
          hyperionActionsIncorrectMessage += ", action is older than 5min";
        }
      }
      hyperion.actions_message = hyperionActionsIncorrectMessage;
      if (!hyperion.actions_ok) failedRequestCounter++;
    });

  /**
   * Test 4 NodeHyperion get_key_accounts
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
      hyperion.key_accounts_ms = response.elapsedTimeInMilliseconds;
      hyperion.key_accounts_ok =
        response.ok && response.isJson() && response.getDataItem(["account_names"]) !== undefined;
      hyperion.key_accounts_message = response.getFormattedErrorMessage();

      if (!hyperion.key_accounts_ok) failedRequestCounter++;
    });

  /**
   * NodeHyperion Health
   */
  // failed_trx && deferred_trx && resource_limits && resource_usage are ignored
  if (
    hyperion.health_found &&
    hyperion.health_version_ok &&
    hyperion.health_host_ok &&
    hyperion.health_query_time_ok &&
    hyperion.health_features_tables_proposals_on &&
    hyperion.health_features_tables_accounts_on &&
    hyperion.health_features_tables_voters_on &&
    hyperion.health_features_index_deltas_on &&
    hyperion.health_features_index_transfer_memo_on &&
    hyperion.health_features_index_all_deltas_on &&
    hyperion.health_elastic_ok &&
    hyperion.health_rabbitmq_ok &&
    hyperion.health_nodeosrpc_ok &&
    hyperion.health_total_indexed_blocks_ok &&
    hyperion.transaction_ok &&
    hyperion.actions_ok &&
    hyperion.key_accounts_ok
  ) {
    hyperion.all_checks_ok = true;
  } else {
    hyperion.all_checks_ok = false;
  }

  /**
   * Store results in Database
   */
  try {
    await database.manager.save(hyperion);
    childLogger.debug(
      "SAVED \t New NodeHyperion validation to database for " +
      guild.name +
      " " +
      (isMainnet ? "mainnet" : "testnet") +
      " to database"
    );
  } catch (error) {
    childLogger.fatal("Error while saving new NodeHyperion validation to database", error);
  }

  return hyperion;
}