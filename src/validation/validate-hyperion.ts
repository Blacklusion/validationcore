import {
  allChecksOK,
  combineValidationLevel,
  calculateValidationLevel,
  logger, validateBpLocation, extractLongitude, extractLatitude
} from "../validationcore-database-scheme/common";
import { Guild } from "../validationcore-database-scheme/entity/Guild";
import * as config from "config";
import { Logger } from "tslog";
import { getConnection } from "typeorm";
import * as http from "../httpConnection/HttpRequest";
import { NodeHyperion } from "../validationcore-database-scheme/entity/NodeHyperion";
import { isURL } from "validator";
import { ValidationLevel } from "../validationcore-database-scheme/enum/ValidationLevel";
import { getChainsConfigItem } from "../validationcore-database-scheme/readConfig";

/**
 * Logger Settings for NodeHyperion
 */
const childLogger: Logger = logger.getChildLogger({
  name: "Hyperion-Validation",
});

/**
 * Performs all validations of the NodeHyperion
 * @param {Guild} guild = guild for which the NodeHyperion is validated (must be tracked in database)
 * @param {string} chainId = chainId of chain that is validated
 * @param {string} endpointUrl = url of the api node (http and https possible)
 * @param {boolean} isSSL = if true, it is also validated if TLS is working. Then the NodeApi will only be considered healthy, if all checks pass and if TLS is working
 * @param {unknown} location = location information as in bp.json
 */
export async function validateHyperion(
  guild: Guild,
  chainId: string,
  endpointUrl: string,
  isSSL: boolean,
  location: unknown
): Promise<NodeHyperion> {
  if (!endpointUrl) return undefined;

  // Counts how many requests have failed. If performance mode is enabled, future requests may not be performed, if to many requests already failed
  let failedRequestCounter = 0;

  // Create hyperion object for database
  const database = getConnection(chainId);
  const hyperion: NodeHyperion = new NodeHyperion();
  hyperion.instance_id = config.get("general.instance_id")
  hyperion.guild = guild.name;
  hyperion.endpoint_url = endpointUrl;
  hyperion.is_ssl = isSSL;


  if (getChainsConfigItem(chainId, "nodeHyperion_location")) {
    hyperion.location_ok = calculateValidationLevel(validateBpLocation(location), chainId, "nodeHyperion_location_level");
    hyperion.location_longitude = extractLongitude(location);
    hyperion.location_latitude = extractLatitude(location);
  }

  // Check if valid EndpointUrl has been provided
  if (getChainsConfigItem(chainId, "nodeHyperion_endpoint_url_ok")) {
    const endpointUrlOk = isURL(endpointUrl, {
      require_protocol: true,
    });
    hyperion.endpoint_url_ok = calculateValidationLevel(endpointUrlOk, chainId, "nodeHyperion_endpoint_url_ok_level");
  }

  /**
   * Test 1 Hyperion Health
   */
  if (getChainsConfigItem(chainId, "nodeHyperion_health")) {
    await http
      .request(endpointUrl, "nodeHyperion_health", chainId, failedRequestCounter)
      .then((response) => {

        /**
         * SSL Check
         */
        if (isSSL && getChainsConfigItem(chainId, "nodeHyperion_ssl")) {
          http.evaluateSSL(endpointUrl, response.ok, response.errorType).then((response) => {
            hyperion.ssl_ok = calculateValidationLevel(response.ok, chainId, "nodeHyperion_ssl_level");
            hyperion.ssl_errortype = response.errorType;
            if (hyperion.ssl_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
          });
        }

        const healthFound = response.ok && response.isJson();
        hyperion.health_found = calculateValidationLevel(healthFound, chainId, "nodeHyperion_health_level");
        hyperion.health_ms = response.elapsedTimeInMilliseconds;
        hyperion.health_errortype = response.errorType;
        hyperion.health_httpcode = response.httpCode;

        if (hyperion.health_found !== ValidationLevel.SUCCESS) {
          failedRequestCounter++;
          return;
        }

        // Test 1.1 Health version
        // todo: add check
        if (getChainsConfigItem(chainId, "nodeHyperion_health_version")) {
          const healthVersionOk = response.getDataItem(["version"]) !== undefined;
          hyperion.health_version_ok = calculateValidationLevel(
            healthVersionOk,
            chainId,
            "nodeHyperion_health_version_level"
          );
          hyperion.server_version = response.getDataItem(["version"])
        }

        // Test 1.2 Health Host
        // todo: add check
        if (getChainsConfigItem(chainId, "nodeHyperion_health_host")) {
          const healthHostOk = response.getDataItem(["host"]) !== undefined;
          hyperion.health_host_ok = calculateValidationLevel(healthHostOk, chainId, "nodeHyperion_health_host_level");
        }

        // Test 1.3 Query Time
        if (getChainsConfigItem(chainId, "nodeHyperion_health_query_time")) {
          if (typeof response.getDataItem(["query_time_ms"]) === "number") {
            // Set status in database
            hyperion.health_query_time_ms = Math.round(response.getDataItem(["query_time_ms"]));
            const healthQueryTimeOk =
              response.getDataItem(["query_time_ms"]) < config.get("validation.hyperion_query_time_ms");
            hyperion.health_query_time_ok = calculateValidationLevel(
              healthQueryTimeOk,
              chainId,
              "nodeHyperion_health_query_time_level"
            );
          }
        }

        /**
         * Test 1.4 Features
         */
        // todo: test code
        if (getChainsConfigItem(chainId, "nodeHyperion_health_features") && response.getDataItem(["features"])) {
          // tables/proposals
          const healthFeaturesTablesProposals =
            response.getDataItem(["features", "tables", "proposals"]) ===
              getChainsConfigItem(chainId, "nodeHyperion_health_features_tables_proposals") ||
            (response.getDataItem(["features", "tables", "proposals"]) === undefined &&
              !getChainsConfigItem(chainId, "nodeHyperion_health_features_tables_proposals"));
          hyperion.health_features_tables_proposals = calculateValidationLevel(
            healthFeaturesTablesProposals,
            chainId,
            "nodeHyperion_health_features_tables_proposals_level"
          );

          // tables/accounts
          const healthFeaturesTablesAccounts =
            response.getDataItem(["features", "tables", "accounts"]) ===
              getChainsConfigItem(chainId, "nodeHyperion_health_features_tables_accounts") ||
            (response.getDataItem(["features", "tables", "accounts"]) === undefined &&
              !getChainsConfigItem(chainId, "nodeHyperion_health_features_tables_accounts"));
          hyperion.health_features_tables_accounts = calculateValidationLevel(
            healthFeaturesTablesAccounts,
            chainId,
            "nodeHyperion_health_features_tables_accounts_level"
          );

          // tables/voters
          const healthFeaturesTablesVoters =
            response.getDataItem(["features", "tables", "voters"]) ===
              getChainsConfigItem(chainId, "nodeHyperion_health_features_tables_voters") ||
            (response.getDataItem(["features", "tables", "voters"]) === undefined &&
              !getChainsConfigItem(chainId, "nodeHyperion_health_features_tables_voters"));
          hyperion.health_features_tables_voters = calculateValidationLevel(
            healthFeaturesTablesVoters,
            chainId,
            "nodeHyperion_health_features_tables_voters_level"
          );

          // index_deltas
          const healthFeaturesIndexDeltas =
            response.getDataItem(["features", "index_deltas"]) ===
              getChainsConfigItem(chainId, "nodeHyperion_health_features_index_deltas") ||
            (response.getDataItem(["features", "index_deltas"]) === undefined &&
              !getChainsConfigItem(chainId, "nodeHyperion_health_features_index_deltas"));
          hyperion.health_features_index_deltas = calculateValidationLevel(
            healthFeaturesIndexDeltas,
            chainId,
            "nodeHyperion_health_features_index_deltas_level"
          );

          // index_transfer_memo
          const healthFeaturesIndexTransferMemo =
            response.getDataItem(["features", "index_transfer_memo"]) ===
              getChainsConfigItem(chainId, "nodeHyperion_health_features_index_transfer_memo") ||
            (response.getDataItem(["features", "index_transfer_memo"]) === undefined &&
              !getChainsConfigItem(chainId, "nodeHyperion_health_features_index_transfer_memo"));
          hyperion.health_features_index_transfer_memo = calculateValidationLevel(
            healthFeaturesIndexTransferMemo,
            chainId,
            "nodeHyperion_health_features_index_transfer_memo_level"
          );

          // index_all_deltas
          const healthFeaturesIndexAllDeltas =
            response.getDataItem(["features", "index_all_deltas"]) ===
              getChainsConfigItem(chainId, "nodeHyperion_health_features_index_all_deltas") ||
            (response.getDataItem(["features", "index_all_deltas"]) === undefined &&
              !getChainsConfigItem(chainId, "nodeHyperion_health_features_index_all_deltas"));
          hyperion.health_features_index_all_deltas = calculateValidationLevel(
            healthFeaturesIndexAllDeltas,
            chainId,
            "nodeHyperion_health_features_index_all_deltas_level"
          );

          // deferred_trx
          const healthFeaturesDeferredTrx =
            response.getDataItem(["features", "deferred_trx"]) ===
              getChainsConfigItem(chainId, "nodeHyperion_health_features_deferred_trx") ||
            (response.getDataItem(["features", "deferred_trx"]) === undefined &&
              !getChainsConfigItem(chainId, "nodeHyperion_health_features_deferred_trx"));
          hyperion.health_features_deferred_trx = calculateValidationLevel(
            healthFeaturesDeferredTrx,
            chainId,
            "nodeHyperion_health_features_deferred_trx_level"
          );

          // failed_trx
          const healthFeaturesFailedTrx =
            response.getDataItem(["features", "failed_trx"]) ===
              getChainsConfigItem(chainId, "nodeHyperion_health_features_failed_trx") ||
            (response.getDataItem(["features", "failed_trx"]) === undefined &&
              !getChainsConfigItem(chainId, "nodeHyperion_health_features_failed_trx"));
          hyperion.health_features_failed_trx = calculateValidationLevel(
            healthFeaturesFailedTrx,
            chainId,
            "nodeHyperion_health_features_failed_trx_level"
          );

          // resource_limits disabled
          const healthFeaturesResourceLimits =
            response.getDataItem(["features", "resource_limits"]) ===
              getChainsConfigItem(chainId, "nodeHyperion_health_features_resource_limits") ||
            (response.getDataItem(["features", "resource_limits"]) === undefined &&
              !getChainsConfigItem(chainId, "nodeHyperion_health_features_resource_limits"));
          hyperion.health_features_resource_limits = calculateValidationLevel(
            healthFeaturesResourceLimits,
            chainId,
            "nodeHyperion_health_features_resource_limits_level"
          );

          // resource_usage disabled
          const healthFeaturesResourceUsage =
            response.getDataItem(["features", "resource_usage"]) ===
              getChainsConfigItem(chainId, "nodeHyperion_health_features_resource_usage") ||
            (response.getDataItem(["features", "resource_usage"]) === undefined &&
              !getChainsConfigItem(chainId, "nodeHyperion_health_features_resource_usage"));
          hyperion.health_features_resource_usage = calculateValidationLevel(
            healthFeaturesResourceUsage,
            chainId,
            "nodeHyperion_health_features_resource_usage_level"
          );
          hyperion.health_all_features_ok = combineValidationLevel([
            hyperion.health_features_tables_proposals,
            hyperion.health_features_tables_accounts,
            hyperion.health_features_tables_voters,
            hyperion.health_features_index_deltas,
            hyperion.health_features_index_transfer_memo,
            hyperion.health_features_index_all_deltas,
            hyperion.health_features_deferred_trx,
            hyperion.health_features_failed_trx,
            hyperion.health_features_resource_limits,
            hyperion.health_features_resource_usage,
          ]);
        }

        /**
         * Test 1.5 Health of Services
         */
        let nodeosRpc;
        let rabbitmq;
        let elastic;
        if (Array.isArray(response.getDataItem(["health"]))) {
          nodeosRpc = response.getDataItem(["health"]).find((x) => x.service === "NodeosRPC");
          rabbitmq = response.getDataItem(["health"]).find((x) => x.service === "RabbitMq");
          elastic = response.getDataItem(["health"]).find((x) => x.service === "Elasticsearch");
        }

        // NodeosRPC
        let nodeosRpcIncorrectMessage = "";
        if (
          getChainsConfigItem(chainId, "nodeHyperion_health_services_nodeosrpc") &&
          nodeosRpc !== undefined &&
          nodeosRpc.status === "OK" &&
          nodeosRpc.service_data !== undefined &&
          nodeosRpc.service_data.time_offset !== undefined
        ) {
          hyperion.health_nodeosrpc_ok = calculateValidationLevel(
            true,
            chainId,
            "nodeHyperion_health_services_nodeosrpc_level"
          );

          // Check time offset
          if (nodeosRpc.service_data.time_offset < -500 || nodeosRpc.service_data.time_offset > 2000) {
            nodeosRpcIncorrectMessage +=
              "time offset invalid (" + nodeosRpc.service_data.time_offset + ") must be between -500 and 2000";
          }

          // Check chainId
          if (nodeosRpc.service_data.chain_id !== chainId) {
            nodeosRpcIncorrectMessage += (nodeosRpcIncorrectMessage === "" ? "" : ", ") + "wrong chainId";
          }
        }
        hyperion.health_nodeosrpc_message = nodeosRpcIncorrectMessage === "" ? null : nodeosRpcIncorrectMessage;

        // RabbitMq
        if (getChainsConfigItem(chainId, "nodeHyperion_health_services_rabbitmq")) {
          const rabbitmqOk = rabbitmq !== undefined && rabbitmq.status === "OK";
          hyperion.health_rabbitmq_ok = calculateValidationLevel(
            rabbitmqOk,
            chainId,
            "nodeHyperion_health_services_rabbitmq_level"
          );
        }

        // Elastic
        if (getChainsConfigItem(chainId, "nodeHyperion_health_services_elastic")) {
          const elasticOk =
            elastic !== undefined &&
            elastic.status === "OK" &&
            elastic.service_data !== undefined &&
            elastic.service_data.active_shards === "100.0%";
          hyperion.health_elastic_ok = calculateValidationLevel(
            elasticOk,
            chainId,
            "nodeHyperion_health_services_elastic_level"
          );

          // Elastic - Total indexed blocks
          if (
            getChainsConfigItem(chainId, "nodeHyperion_health_total_indexed_blocks") &&
            elastic !== undefined &&
            elastic.service_data !== undefined &&
            typeof elastic.service_data.last_indexed_block === "number" &&
            typeof elastic.service_data.total_indexed_blocks === "number"
          ) {
            const missingBlocks = elastic.service_data.last_indexed_block - elastic.service_data.total_indexed_blocks;
            hyperion.health_missing_blocks = missingBlocks;
            const totalIndexedBlocksOk = missingBlocks <= config.get("validation.hyperion_tolerated_missing_blocks");
            hyperion.health_total_indexed_blocks_ok = calculateValidationLevel(
              totalIndexedBlocksOk,
              chainId,
              "nodeHyperion_health_total_indexed_blocks_level"
            );

          }
        }
      });
  }

  /**
   * Test 2 get_transaction
   */
  if (getChainsConfigItem(chainId, "nodeHyperion_get_transaction")) {
    await http
      .request(endpointUrl, "nodeHyperion_get_transaction", chainId, failedRequestCounter)
      .then((response) => {
        hyperion.get_transaction_ok = calculateValidationLevel(
          response.ok,
          chainId,
          "nodeHyperion_get_transaction_level"
        );
        hyperion.get_transaction_ms = response.elapsedTimeInMilliseconds;
        hyperion.get_transaction_errortype = response.errorType;
        hyperion.get_transaction_httpcode = response.httpCode;

        if (hyperion.get_transaction_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
      });
  }

  /**
   * Test 3 get_actions
   */
  if (getChainsConfigItem(chainId, "nodeHyperion_get_actions")) {
    await http
      .request(endpointUrl, "nodeHyperion_get_actions", chainId, failedRequestCounter)
      .then((response) => {
        hyperion.get_actions_ms = response.elapsedTimeInMilliseconds;
        hyperion.get_actions_errortype = response.errorType;
        hyperion.get_actions_httpcode = response.httpCode;

        // block_time missing in last action
        if (
          response.ok &&
          Array.isArray(response.getDataItem(["actions"])) &&
          response.getDataItem(["actions"]).length == 1 &&
          response.getDataItem(["actions"])[0]["@timestamp"]
        ) {
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
            hyperion.get_actions_ok = calculateValidationLevel(true, chainId, "nodeHyperion_get_actions_level");
          }
        } else {
          hyperion.get_actions_ok = calculateValidationLevel(false, chainId, "nodeHyperion_get_actions_level");
        }
        if (hyperion.get_actions_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
      });
  }

  /**
   * Test 4 get_key_accounts
   */
  if (getChainsConfigItem(chainId, "nodeHyperion_get_key_accounts")) {
    await http
      .request(
        endpointUrl,
        "nodeHyperion_get_key_accounts",
        chainId,
        failedRequestCounter
      )
      .then((response) => {
        hyperion.get_key_accounts_ms = response.elapsedTimeInMilliseconds;
        const getKeyAccountsOk =
          response.ok && response.isJson() && response.getDataItem(["account_names"]) !== undefined;
        hyperion.get_key_accounts_ok = calculateValidationLevel(
          getKeyAccountsOk,
          chainId,
          "nodeHyperion_get_key_accounts_level"
        );
        hyperion.get_key_accounts_errortype = response.errorType;
        hyperion.get_key_accounts_httpcode = response.httpCode;

        if (hyperion.get_key_accounts_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
      });
  }

  /**
   * Test 5 get_created_accounts
   */
  if (getChainsConfigItem(chainId, "nodeHyperion_get_created_accounts")) {
    await http
      .request(
        endpointUrl,
        "nodeHyperion_get_created_accounts",
        chainId,
        failedRequestCounter
      )
      .then((response) => {
        let getCreatedAccountsOk =
          response.ok && response.isJson() &&  Array.isArray(response.getDataItem(["accounts"]));

        if (getCreatedAccountsOk) {
          const arrayFromConfig = getChainsConfigItem(chainId, "$nodeHyperion_created_accounts").split(",");
          getCreatedAccountsOk = getCreatedAccountsOk && response.getDataItem(["accounts"]).length === arrayFromConfig.length;

          response.getDataItem(["accounts"]).forEach(x => {
            getCreatedAccountsOk = getCreatedAccountsOk && x && x.name && arrayFromConfig.includes(x.name);
          })
        }

        hyperion.get_created_accounts_ok = calculateValidationLevel(
          getCreatedAccountsOk,
          chainId,
          "nodeHyperion_get_created_accounts_level"
        );

        hyperion.get_created_accounts_ms = response.elapsedTimeInMilliseconds;
        hyperion.get_created_accounts_errortype = response.errorType;
        hyperion.get_created_accounts_httpcode = response.httpCode;

        if (hyperion.get_created_accounts_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
      });
  }

  /**
   * NodeHyperion Health
   */
  const validations: [string, ValidationLevel][] = [
    ["nodeHyperion_location", hyperion.location_ok],
    ["nodeHyperion_endpoint_url_ok", hyperion.endpoint_url_ok],
    ["nodeHyperion_health", hyperion.health_found],
    ["nodeHyperion_health_version", hyperion.health_version_ok],
    ["nodeHyperion_health_host", hyperion.health_host_ok],
    ["nodeHyperion_health_query_time", hyperion.health_query_time_ok],
    ["nodeHyperion_health_features", hyperion.health_all_features_ok],
    ["nodeHyperion_health_services_nodeosrpc", hyperion.health_nodeosrpc_ok],
    ["nodeHyperion_health_services_rabbitmq", hyperion.health_rabbitmq_ok],
    ["nodeHyperion_health_services_elastic", hyperion.health_elastic_ok],
    ["nodeHyperion_health_total_indexed_blocks", hyperion.health_total_indexed_blocks_ok],
    ["nodeHyperion_get_transaction", hyperion.get_transaction_ok],
    ["nodeHyperion_get_actions", hyperion.get_actions_ok],
    ["nodeHyperion_get_key_accounts", hyperion.get_key_accounts_ok],
    ["nodeHyperion_get_created_accounts", hyperion.get_created_accounts_ok],
  ];

  if (isSSL) validations.push(["nodeHyperion_ssl", hyperion.ssl_ok]);
  hyperion.all_checks_ok = allChecksOK(validations, chainId);

  /**
   * Store results in Database
   */
  try {
    await database.manager.save(hyperion);
    childLogger.debug(
      "SAVED \t New NodeHyperion validation to database for " +
        guild.name +
        " " +
        getChainsConfigItem(chainId, "name") +
        " to database"
    );
  } catch (error) {
    childLogger.fatal("Error while saving new NodeHyperion validation to database", error);
  }

  return hyperion;
}
