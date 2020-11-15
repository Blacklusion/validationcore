import { logger } from "../common";
import { Guild } from "../database/entity/Guild";
import * as config from "config";
import { Logger } from "tslog";
import { History } from "../database/entity/History";
import { getConnection } from "typeorm";
import { sendMessageHistory } from "../telegramHandler";
import { HttpErrorType } from "../httpConnection/HttpErrorType";
import * as http from "../httpConnection/HttpRequest";
import { convertArrayToJson, evaluateMessage } from "../messageHandler";

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
 * @param {History} lastValidation = last validation of the SAME History Endpoint
 * @param {string} apiEndpoint = url of the api node (http and https possible)
 * @param {boolean} isSsl = if true, it is also validated if TLS is working. Then the Api will only be considered healthy, if all checks pass and if TLS is working
 */
export async function validateAll(
  guild: Guild,
  isMainnet: boolean,
  lastValidation: History,
  apiEndpoint: string,
  isSsl: boolean
): Promise<[History, any]> {
  if (!apiEndpoint) return undefined;

  let validationMessages: Array<[string, number]> = [];

  const database = getConnection();
  const history: History = new History();
  history.guild = guild.name;
  history.api_endpoint = apiEndpoint;

  if (!lastValidation) lastValidation = new History();

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
      await http.get(apiEndpoint, "",  0).then((response) => {
        if (response.ok || (!response.ok && response.errorType === HttpErrorType.HTTP)) {
          history.ssl_ok = true;
        } else {
          history.ssl_ok = false;
          sslMessage = "not ok: " + response.getFormattedErrorMessage();
        }
      });
    }
    validationMessages.push(evaluateMessage(lastValidation.ssl_ok, history.ssl_ok, "TLS", "ok", sslMessage));
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
        "json": true,
        "id": config.get((isMainnet ? "mainnet" : "testnet") + ".history_test_transaction")
      }
    )
    .then((response) => {
      history.history_transaction_ok = response.ok && response.isJson();
      history.history_transaction_ms = response.elapsedTimeInMilliseconds;

      validationMessages.push(
        evaluateMessage(
          lastValidation.history_transaction_ok,
          history.history_transaction_ok,
          "History get_transaction test",
          "passed",
          "not passed" + response.getFormattedErrorMessage()
        )
      );
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
        "json": true,
        "pos": -1,
        "offset": (config.get("validation.history_transaction_offset") * -1),
        "account_name": "eosio.token"
      }
    )
    .then((response) => {
      history.history_actions_ms = response.elapsedTimeInMilliseconds;
      let errorCounter = 0;

      if (!response.ok || !response.isJson()) {
        historyActionsIncorrectMessage = response.getFormattedErrorMessage();
        history.hyperion_actions_ok = false;
        return;
      }

      // Test if request is success

      // action request contains correct number of actions
      if (
        !(
          Array.isArray(response.getDataItem(["actions"])) &&
          response.getDataItem(["actions"]).length === config.get("validation.history_transaction_offset")
        )
      ) {
        historyActionsIncorrectMessage += ", returned incorrect number of actions";
        errorCounter++;
      }

      // action request contains last_irreversible_block
      if (!response.getDataItem(["last_irreversible_block"])) {
        historyActionsIncorrectMessage += ", last irreversible block not provided";
        errorCounter++;
      }

      // action request contains recent eosio.ram action
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
        const timeDelta: number = new Date(response.getDataItem(["actions"])[0].block_time + "+00:00").getTime() - currentDate;

        if (!(Math.abs(timeDelta) < config.get("validation.history_actions_block_time_delta"))) {
          historyActionsIncorrectMessage +=
            ", last eosio.ram action older than " +
            config.get("validation.history_actions_block_time_delta") / 60000 +
            "min";
          errorCounter++;
        }
      } else {
        historyActionsIncorrectMessage += ", no block_time provided";
        errorCounter++;
      }

      // Status ok if all checks are passed
      history.history_actions_ok = errorCounter == 0;
    });
  validationMessages.push(
    evaluateMessage(
      lastValidation.history_actions_ok,
      history.history_actions_ok,
      "History get_actions test",
      "passed",
      "not passed" + historyActionsIncorrectMessage
    )
  );

  /**
   * Test 1.3 get_key_accounts
   */
  await http
    .post(
      apiEndpoint,
      "/v1/history/get_key_accounts",
      {
        "json": true,
        "public_key": config.get((isMainnet ? "mainnet" : "testnet") + ".history_test_public_key")
        }
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

      validationMessages.push(
        evaluateMessage(
          lastValidation.history_key_accounts_ok,
          history.history_key_accounts_ok,
          "History get_key_accounts test",
          "passed",
          "not passed" + historyKeyIncorrectMessage
        )
      );
    });

  // todo: check
  history.history_all_checks_ok =
    history.history_transaction_ok && history.history_key_accounts_ok && history.history_actions_ok;

  /**
   * 2. HYPERION
   */

  /**
   * Test 2.1 Hyperion Health
   */
  await http.get(apiEndpoint, "/v2/health").then((response) => {
    // Test 2.1.1 Health version
    history.hyperion_health_version_ok = response.getDataItem(["version"]) !== undefined;
    validationMessages.push(
      evaluateMessage(
        lastValidation.hyperion_health_version_ok,
        history.hyperion_health_version_ok,
        "Hyperion version",
        "provided in /v2/health",
        "not provided in /v2/health"
      )
    );

    // Test 2.1.2 Health Host
    history.hyperion_health_host_ok = response.getDataItem(["host"]) !== undefined;
    validationMessages.push(
      evaluateMessage(
        lastValidation.hyperion_health_host_ok,
        history.hyperion_health_host_ok,
        "Hyperion host",
        "provided in /v2/health",
        "not provided in /v2/health"
      )
    );

    // Test 2.1.3 Query Time
    let queryTimeIncorrectMessage = "not provided";
    if (typeof response.getDataItem(["query_time_ms"]) === "number") {
      history.hyperion_health_query_time_ms = Math.round(response.getDataItem(["query_time_ms"]));
      queryTimeIncorrectMessage = "too high (" + history.hyperion_health_query_time_ms + " > " +  + ")";
    }
    history.hyperion_health_query_time_ok =
      typeof response.getDataItem(["query_time_ms"]) === "number" && response.getDataItem(["query_time_ms"]) < config.get("validation.hyperion_query_time_ms");

    validationMessages.push(
      evaluateMessage(
        lastValidation.history_key_accounts_ok,
        history.history_key_accounts_ok,
        "Hyperion query time",
        "ok",
        queryTimeIncorrectMessage
      )
    );

    /**
     * Test 2.1.4 Features
     */
    let featureMessage = "";
    if (!response.getDataItem(["features"])) {
      featureMessage = ", features array is missing";
      history.hyperion_health_all_features_ok = false;
    } else {
      let errorCounter = 0;
      // tables
      if (!response.getDataItem(["features", "tables"])) {
        featureMessage = ", features.tables array missing";
      } else {
        // tables/proposals enabled
        if (response.getDataItem(["features" , "tables", "proposals"]) == true) {
          history.hyperion_health_features_tables_proposals_on = true;
        } else {
          history.hyperion_health_features_tables_proposals_on = false;
          errorCounter++;
          featureMessage += ", tables/proposals is disabled";
        }

        // tables/accounts enabled
        if (response.getDataItem(["features", "tables", "accounts"]) == true) {
          history.hyperion_health_features_tables_accounts_on = true;
        } else {
          history.hyperion_health_features_tables_accounts_on = false;
          errorCounter++;
          featureMessage += ", tables/accounts is disabled";
        }

        // tables/voters enabled
        if (response.getDataItem(["features", "tables", "voters"]) == true) {
          history.hyperion_health_features_tables_voters_on = true;
        } else {
          history.hyperion_health_features_tables_voters_on = false;
          errorCounter++;
          featureMessage += ", tables/voters is disabled";
        }
      }

      // index_deltas enabled
      if (response.getDataItem(["features", "index_deltas"]) == true) {
        history.hyperion_health_features_index_deltas_on = true;
      } else {
        history.hyperion_health_features_index_deltas_on = false;
        errorCounter++;
        featureMessage += ", index_deltas is disabled";
      }

      // index_transfer_memo enabled
      if (response.getDataItem(["features", "index_transfer_memo"]) == true) {
        history.hyperion_health_features_index_transfer_memo_on = true;
      } else {
        history.hyperion_health_features_index_transfer_memo_on = false;
        errorCounter++;
        featureMessage += ", index_transfer_memo is disabled";
      }

      // index_all_deltas enabled
      if (response.getDataItem(["features", "index_all_deltas"]) == true) {
        history.hyperion_health_features_index_all_deltas_on = true;
      } else {
        history.hyperion_health_features_index_all_deltas_on = false;
        errorCounter++;
        featureMessage += ", index_all_deltas is disabled";
      }

      // deferred_trx disabled
      if (response.getDataItem(["features", "deferred_trx"]) == false || response.getDataItem(["features", "deferred_trx"]) === undefined) {
        history.hyperion_health_features_index_deferred_trx_off = true;
      } else {
        history.hyperion_health_features_index_deferred_trx_off = false;
        errorCounter++;
        featureMessage += ", deferred_trx is enabled";
      }

      // failed_trx disabled
      if (response.getDataItem(["features", "failed_trx"]) == false || response.getDataItem(["features", "failed_trx"]) === undefined) {
        history.hyperion_health_features_index_failed_trx_off = true;
      } else {
        history.hyperion_health_features_index_failed_trx_off = false;
        errorCounter++;
        featureMessage += ", failed_trx is enabled";
      }

      // resource_limits disabled
      if (response.getDataItem(["features", "resource_limits"]) == false || response.getDataItem(["features", "resource_limits"]) === undefined) {
        history.hyperion_health_features_resource_limits_off = true;
      } else {
        history.hyperion_health_features_resource_limits_off = false;
        errorCounter++;
        featureMessage += ", resource_limits is enabled";
      }

      // resource_usage disabled
      if (response.getDataItem(["features", "resource_usage"]) == false || response.getDataItem(["features", "resource_usage"]) === undefined) {
        history.hyperion_health_features_resource_usage_off = true;
      } else {
        history.hyperion_health_features_resource_usage_off = false;
        errorCounter++;
        featureMessage += ", resource_usage is enabled";
      }

      history.hyperion_health_all_features_ok = errorCounter == 0;
    }
    validationMessages.push(
      evaluateMessage(
        lastValidation.hyperion_health_all_features_ok,
        history.hyperion_health_all_features_ok,
        "Hyperion features",
        "ok",
        "not ok" + featureMessage
      )
    );

    /**
     * Test 2.1.5 Health of Services
     */
    if (Array.isArray(response.getDataItem(["health"]))) {
      childLogger.debug("FALSE \t Hyperion Health is missing field Health");
    } else {
      // NodeosRPC
      const nodeosRpc = response.getDataItem(["health"]).find((x) => x.service === "NodeosRPC");
      history.hyperion_health_nodeosrpc_ok =
        nodeosRpc &&
        nodeosRpc.status === "OK" &&
        nodeosRpc.service_data &&
        nodeosRpc.service_data.time_offset >= -500 &&
        nodeosRpc.service_data.time_offset <= 2000;

      // RabbitMq
      history.hyperion_health_rabbitmq_ok = response.getDataItem(["health"]).find(
        (x) => x.service === "RabbitMq" && x.status === "OK"
      );

      // Elastic
      const elastic = response.getDataItem(["health"]).find((x) => x.service === "Elasticsearch");
      history.hyperion_health_elastic_ok =
        elastic && elastic.status === "OK" && elastic.service_data && elastic.service_data.active_shards === "100.0%";

      // Elastic - Total indexed blocks
      history.hyperion_health_total_indexed_blocks_ok =
        elastic &&
        elastic.service_data &&
        elastic.service_data.last_indexed_block == elastic.service_data.total_indexed_blocks;
    }
  });

  // todo: add validation message
  /**
   * Test 2.2 Hyperion get_transaction
   */
  await http
    .get(
      apiEndpoint,
      "/v2/history/get_transaction?id=" + config.get((isMainnet ? "mainnet" : "testnet") + ".history_test_transaction")
    )
    .then((response) => {
      history.hyperion_transaction_ok = response.ok;
      history.hyperion_transaction_ms = response.elapsedTimeInMilliseconds;

      validationMessages.push(
        evaluateMessage(
          lastValidation.hyperion_transaction_ok,
          history.hyperion_transaction_ok,
          "Hyperion get_transaction test",
          "passed",
          "not passed" + response.getFormattedErrorMessage()
        )
      );
    });

  /**
   * Test 2.3 Hyperion get_actions
   */
  await http.get(apiEndpoint, "/v2/history/get_actions?limit=1").then((response) => {
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
      const timeDelta: number = currentDate - new Date(response.getDataItem(["actions"])[0]["@timestamp"] + "+00:00").getTime();

      // Hyperion up-to-date
      if (Math.abs(timeDelta) < 300000) {
        history.hyperion_actions_ok = true;
      } else {
        // Hyperion not up-to-date: last action is older than 5min
        history.hyperion_actions_ok = false;
        hyperionActionsIncorrectMessage += ", action is older than 5min";
      }
    }

    validationMessages.push(
      evaluateMessage(
        lastValidation.hyperion_actions_ok,
        history.hyperion_actions_ok,
        "Hyperion get_actions test",
        "passed",
        "not passed" + hyperionActionsIncorrectMessage
      )
    );
  });

  /**
   * Test 2.4 Hyperion get_key_accounts
   */
  await http
    .post(
      apiEndpoint,
      "/v2/state/get_key_accounts",
      {
        "public_key": config.get((isMainnet ? "mainnet" : "testnet") + ".history_test_public_key")
      }
    )
    .then((response) => {
      history.hyperion_key_accounts_ms = response.elapsedTimeInMilliseconds;
      history.hyperion_key_accounts_ok = response.ok && response.isJson() && response.getDataItem(["actions", "account_names"]);

      validationMessages.push(
        evaluateMessage(
          lastValidation.hyperion_key_accounts_ok,
          history.hyperion_key_accounts_ok,
          "Hyperion get_key_accounts test",
          "passed",
          "not passed" + response.getFormattedErrorMessage()
        )
      );
    });

  /**
   * Check total health of history
   */
  history.hyperion_all_checks_ok =
    history.hyperion_health_version_ok &&
    history.hyperion_health_host_ok &&
    history.hyperion_health_query_time_ok &&
    history.hyperion_health_features_tables_proposals_on &&
    history.hyperion_health_features_tables_accounts_on &&
    history.hyperion_health_features_tables_voters_on &&
    history.hyperion_health_features_index_deltas_on &&
    history.hyperion_health_features_index_transfer_memo_on &&
    history.hyperion_health_features_index_all_deltas_on &&
    history.hyperion_health_features_index_failed_trx_off &&
    history.hyperion_health_features_index_deferred_trx_off &&
    history.hyperion_health_features_resource_limits_off &&
    history.hyperion_health_features_resource_usage_off &&
    history.hyperion_health_all_features_ok &&
    history.hyperion_health_elastic_ok &&
    history.hyperion_health_rabbitmq_ok &&
    history.hyperion_health_nodeosrpc_ok &&
    history.hyperion_health_total_indexed_blocks_ok &&
    history.hyperion_health_active_shards_ok &&
    history.hyperion_transaction_ok &&
    history.hyperion_actions_ok &&
    history.hyperion_key_accounts_ok;

  /**
   * Store results in Database
   */
  try {
    await database.manager.save(history);
    childLogger.info("SAVED \t New History validation to database for " + guild.name + " " +
      (isMainnet ? "mainnet" : "testnet") +
      " to database");
  } catch (error) {
    childLogger.fatal("Error while saving new History validation to database", error);
  }

  /**
   * Send Message to all subscribers of guild via. public telegram service
   */
  sendMessageHistory(guild.name, isMainnet, apiEndpoint, validationMessages);

  return [history, convertArrayToJson(validationMessages, apiEndpoint)];
}
