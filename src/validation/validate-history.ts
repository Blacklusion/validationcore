import * as HttpRequest from "../httpConnection/HttpRequest";
import { logger } from "../common";
import { Guild } from "../database/entity/Guild";
import { Api } from "../database/entity/Api";
import * as config from "config";
import { Logger } from "tslog";
import { History } from "../database/entity/History";
import { getConnection } from "typeorm";
import { evaluateMessage, sendMessageApi, sendMessageHistory } from "../telegramHandler";
import { HttpErrorType } from "../httpConnection/HttpErrorType";

/**
 * Logger Settings for History
 */
const childLogger: Logger = logger.getChildLogger({
  name: "Hist-Validation",
});

/**
 * Performs all validations of the History & Hyperion
 * @param guild
 * @param isMainnet
 * @param lastValidation
 * @param apiEndpoint
 */
export async function validateAll(
  guild: Guild,
  isMainnet: boolean,
  lastValidation: History,
  apiEndpoint: string,
  isSsl: boolean
): Promise<History> {
  if (!apiEndpoint) return undefined;

  let pagerMessages: Array<string> = [];

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
      await HttpRequest.get(apiEndpoint, "", 0)
        .then((response) => {
          history.ssl_ok = true;
        })
        .catch((error) => {
          if (error.type == HttpErrorType.HTTP) {
            history.ssl_ok = true;
          } else if (error.type == HttpErrorType.SSL) {
            sslMessage = "not ok: " + error.message;
            history.ssl_ok = false;
          } else {
            sslMessage = "could not be validated" + (error.message ? ": " + error.message : "");
            history.ssl_ok = false;
          }
        });
    }
    pagerMessages.push(evaluateMessage(lastValidation.ssl_ok, history.ssl_ok, "TLS", "ok", sslMessage));
  }

  /**
   * 1. HISTORY
   */

  /**
   * Test 1.1 get_transaction
   */
  let historyTransactionMessage = "";
  await HttpRequest.post(
    apiEndpoint,
    "/v1/history/get_transaction",
    '{"json": true, "id": "' + config.get((isMainnet ? "mainnet" : "testnet") + ".history_test_transaction") + '"}'
  )
    .then((response) => {
      childLogger.debug("TRUE \t History get_transaction Test passed");
      history.history_transaction_ok = true;
      history.history_transaction_ms = response.elapsedTimeInMilliseconds;
    })
    .catch((error) => {
      childLogger.debug("FALSE \t get_transaction Test not passed");
      history.history_transaction_ok = false;
      historyTransactionMessage += error.message ? ": " + error.message : "";
    });
  pagerMessages.push(
    evaluateMessage(
      lastValidation.history_transaction_ok,
      history.history_transaction_ok,
      "History get_transaction test",
      "passed",
      "not passed" + historyTransactionMessage
    )
  );

  /**
   * Test 1.2 get_actions
   */
  let historyActionsMessage = "";
  await HttpRequest.post(
    apiEndpoint,
    "/v1/history/get_actions",
    '{"json": true, "pos": -1, "offset": -' +
      config.get("validation.history_transaction_offset") +
      ', "account_name": "eosio.token"}'
  )
    .then((response) => {
      history.history_actions_ms = response.elapsedTimeInMilliseconds;
      let errorCounter = 0;

      // Test if request is success
      // todo: test if json

      // action request contains correct number of actions
      if (
        Array.isArray(response.data.actions) &&
        response.data.actions.length == config.get("validation.history_transaction_offset")
      ) {
        childLogger.debug("TRUE \t get_acitons contains correct amount of actions");
      } else {
        childLogger.debug("FALSE \t does not contain correct amount of actions");
        historyActionsMessage += ", returned incorrect number of actions";
        errorCounter++;
      }

      // action request contains last_irreversible_block
      if (response.data["last_irreversible_block"]) {
        childLogger.debug("TRUE \t last irreversible block provided in actions history");
      } else {
        childLogger.debug("FALSE \t last irreversible block not provided in actions history");
        historyActionsMessage += ", last irreversible block not provided";
        errorCounter++;
      }

      // action request contains recent eosio.ram action
      if (
        Array.isArray(response.data.actions) &&
        response.data.actions.length >= 1 &&
        response.data.actions[0].block_time
      ) {
        let currentDate: number = Date.now();
        // Use time of http request if available in order to avoid server or validation time delay
        if (typeof response.headers["date"] == "number") {
          currentDate = new Date(response.headers.date).getTime();
        }
        // "+00:00" is necessary for defining date as UTC
        const timeDelta: number = new Date(response.data.actions[0].block_time + "+00:00").getTime() - currentDate;

        if (Math.abs(timeDelta) < config.get("validation.history_actions_block_time_delta")) {
          childLogger.debug("TRUE \t History contains recent eosio.ram action");
        } else {
          childLogger.debug(
            "FALSE \t History is not up-to-date. eosio.ram action must not be older than " +
              config.get("validation.history_actions_block_time_delta") / 60000 +
              "min"
          );
          historyActionsMessage +=
            ", last eosio.ram action older than " +
            config.get("validation.history_actions_block_time_delta") / 60000 +
            "min";
          errorCounter++;
        }
      } else {
        childLogger.debug("FALSE \t no block_time provided");
        historyActionsMessage += ", no block_time provided";
        errorCounter++;
      }

      if (errorCounter == 0) {
        childLogger.debug("TRUE \t History Get transaction Test passed");
        history.history_actions_ok = true;
      } else {
        history.history_actions_ok = false;
      }
    })
    .catch((error) => {
      childLogger.debug("FALSE \t History Get transaction Test not passed");
      history.history_actions_ok = false;
      if (error.message) historyActionsMessage = ": " + error.message;
    });
  pagerMessages.push(
    evaluateMessage(
      lastValidation.history_actions_ok,
      history.history_actions_ok,
      "History get_actions test",
      "passed",
      "not passed" + historyActionsMessage
    )
  );

  /**
   * Test 1.3 get_key_accounts
   */
  let historyKeyMessage = "";
  await HttpRequest.post(
    apiEndpoint,
    "/v1/history/get_key_accounts",
    '{"json": true, "public_key": "' +
      config.get((isMainnet ? "mainnet" : "testnet") + ".history_test_public_key") +
      '"}'
  )
    .then((response) => {
      history.history_key_accounts_ms = response.elapsedTimeInMilliseconds;
      if (response.data["account_names"]) {
        childLogger.debug("TRUE \t History Key Accounts Test passed");
        history.history_key_accounts_ok = true;
      } else {
        childLogger.debug("FALSE \t History Key Accounts Test passed");
        history.history_key_accounts_ok = false;
        historyKeyMessage += ": invalid response format";
      }
    })
    .catch((error) => {
      childLogger.debug("FALSE \t History Key Accounts Test not passed");
      history.history_key_accounts_ok = false;
      historyKeyMessage = error.message ? ": " + error.message : "";
    });
  pagerMessages.push(
    evaluateMessage(
      lastValidation.history_key_accounts_ok,
      history.history_key_accounts_ok,
      "History get_key_accounts test",
      "passed",
      "not passed" + historyKeyMessage
    )
  );

  history.history_all_checks_ok =
    history.history_transaction_ok && history.history_key_accounts_ok && history.history_actions_ok;

  /**
   * 2. HYPERION
   */

  /**
   * Test 2.1 Hyperion Health
   */
  await HttpRequest.get(apiEndpoint, "/v2/health")
    .then((response) => {
      // Test 2.1.1 Health version
      if (response.data.version) {
        childLogger.debug("TRUE \t Hyperion version provided in /v2/health");
        history.hyperion_health_version_ok = true;
      } else {
        childLogger.debug("FALSE \t Hyperion version not provided in /v2/health");
        history.hyperion_health_version_ok = false;
      }
      pagerMessages.push(
        evaluateMessage(
          lastValidation.hyperion_health_version_ok,
          history.hyperion_health_version_ok,
          "Hyperion version",
          "provided in /v2/health",
          "not provided in /v2/health"
        )
      );

      // Test 2.1.2 Health Host
      if (response.data.host) {
        childLogger.debug("TRUE \t Hyperion Host provided");
        history.hyperion_health_host_ok = true;
      } else {
        childLogger.debug("FALSE \t Hyperion Host not provided");
        history.hyperion_health_host_ok = false;
      }
      pagerMessages.push(
        evaluateMessage(
          lastValidation.hyperion_health_host_ok,
          history.hyperion_health_host_ok,
          "Hyperion host",
          "provided in /v2/health",
          "not provided in /v2/health"
        )
      );

      // Test 2.1.3 Query Time
      if (
        response.data.query_time_ms &&
        response.data.query_time_ms < config.get("validation.hyperion_query_time_ms")
      ) {
        childLogger.debug("TRUE \t Query time ok provided");
        history.hyperion_health_query_time_ok = true;
        history.hyperion_health_query_time_ms = Math.round(response.data.query_time_ms);
      } else {
        childLogger.debug("FALSE \t Query time not provided or too slow");
        history.hyperion_health_query_time_ok = false;
      }
      pagerMessages.push(
        evaluateMessage(
          lastValidation.history_key_accounts_ok,
          history.history_key_accounts_ok,
          "Hyperion query time",
          "ok",
          "not ok"
        )
      );

      /**
       * Test 2.1.4 Features
       */
      let featureMessage = "";
      if (!response.data.features) {
        childLogger.debug("FALSE \t Hyperion Health is missing field Features");
        history.hyperion_health_all_features_ok = false;
      } else {
        let errorCounter = 0;
        // tables
        if (!response.data.features.tables) {
          childLogger.debug("FALSE \t Hyperion Health is missing field Features.Tables");
        } else {
          // tables/proposals enabled
          if (response.data.features.tables.proposals == true) {
            childLogger.debug("*** TRUE *** tables/proposals is enabled");
            history.hyperion_health_features_tables_proposals_on = true;
          } else {
            childLogger.debug("*** FALSE *** tables/proposals is disabled");
            history.hyperion_health_features_tables_proposals_on = false;
            errorCounter++;
            featureMessage += ", tables/proposals is disabled";
          }

          // tables/accounts enabled
          if (response.data.features.tables.accounts == true) {
            childLogger.debug("*** TRUE *** tables/accounts is enabled");
            history.hyperion_health_features_tables_accounts_on = true;
          } else {
            childLogger.debug("*** FALSE *** tables/accounts is disabled");
            history.hyperion_health_features_tables_accounts_on = false;
            errorCounter++;
            featureMessage += ", tables/accounts is disabled";
          }

          // tables/voters enabled
          if (response.data.features.tables.voters == true) {
            childLogger.debug("*** TRUE *** tables/voters is enabled");
            history.hyperion_health_features_tables_voters_on = true;
          } else {
            childLogger.debug("*** FALSE *** tables/voters is disabled");
            history.hyperion_health_features_tables_voters_on = false;
            errorCounter++;
            featureMessage += ", tables/voters is disabled";
          }
        }

        // index_deltas enabled
        if (response.data.features.index_deltas == true) {
          childLogger.debug("*** TRUE *** index_deltas is enabled");
          history.hyperion_health_features_index_deltas_on = true;
        } else {
          childLogger.debug("*** FALSE *** index_deltas is disabled");
          history.hyperion_health_features_index_deltas_on = false;
          errorCounter++;
          featureMessage += ", index_deltas is disabled";
        }

        // index_transfer_memo enabled
        if (response.data.features.index_transfer_memo == true) {
          childLogger.debug("*** TRUE *** index_transfer_memo is enabled");
          history.hyperion_health_features_index_transfer_memo_on = true;
        } else {
          childLogger.debug("*** FALSE *** index_transfer_memo is disabled");
          history.hyperion_health_features_index_transfer_memo_on = false;
          errorCounter++;
          featureMessage += ", index_transfer_memo is disabled";
        }

        // index_all_deltas enabled
        if (response.data.features.index_all_deltas == true) {
          childLogger.debug("*** TRUE *** index_all_deltas is enabled");
          history.hyperion_health_features_index_all_deltas_on = true;
        } else {
          childLogger.debug("*** FALSE *** index_all_deltas is disabled");
          history.hyperion_health_features_index_all_deltas_on = false;
          errorCounter++;
          featureMessage += ", index_all_deltas is disabled";
        }

        // deferred_trx disabled
        if (response.data.features.deferred_trx == false || !response.data.features.deferred_trx) {
          childLogger.debug("*** TRUE *** deferred_trx is disabled");
          history.hyperion_health_features_index_deferred_trx_off = true;
        } else {
          childLogger.debug("*** FALSE *** deferred_trx is enabled");
          history.hyperion_health_features_index_deferred_trx_off = false;
          errorCounter++;
          featureMessage += ", deferred_trx is enabled";
        }

        // failed_trx disabled
        if (response.data.features.failed_trx == false || !response.data.features.failed_trx) {
          childLogger.debug("*** TRUE *** failed_trx is disabled");
          history.hyperion_health_features_index_failed_trx_off = true;
        } else {
          childLogger.debug("*** FALSE *** failed_trx is enabled");
          history.hyperion_health_features_index_failed_trx_off = false;
          errorCounter++;
          featureMessage += ", failed_trx is enabled";
        }

        // resource_limits disabled
        if (response.data.features.resource_limits == false || !response.data.features.resource_limits) {
          childLogger.debug("*** TRUE *** resource_limits is disabled");
          history.hyperion_health_features_resource_limits_off = true;
        } else {
          childLogger.debug("*** FALSE *** resource_limits is enabled");
          history.hyperion_health_features_resource_limits_off = false;
          errorCounter++;
          featureMessage += ", resource_limits is enabled";
        }

        // resource_usage disabled
        if (response.data.features.resource_usage == false || response.data.features.resource_usage) {
          childLogger.debug("*** TRUE *** resource_usage is disabled");
          history.hyperion_health_features_resource_usage_off = true;
        } else {
          childLogger.debug("*** FALSE *** resource_usage is enabled");
          history.hyperion_health_features_resource_usage_off = false;
          errorCounter++;
          featureMessage += ", resource_usage is enabled";
        }

        history.hyperion_health_all_features_ok = errorCounter == 0;
      }
      pagerMessages.push(
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
      if (!response.data.health || !Array.isArray(response.data.health)) {
        childLogger.debug("FALSE \t Hyperion Health is missing field Health");
      } else {
        // NodeosRPC
        const nodeosRpc = response.data.health.find((x) => x.service === "NodeosRPC");
        if (nodeosRpc && nodeosRpc.status === "OK") {
          childLogger.debug("TRUE \t Hyperion nodeosRpc healthy");
        } else {
          childLogger.debug("FALSE \t Hyperion nodeosRpc not healthy. Status in /v2/health should be OK");
        }
        if (
          nodeosRpc &&
          nodeosRpc.service_data &&
          nodeosRpc.service_data.time_offset >= -500 &&
          nodeosRpc.service_data.time_offset <= 2000
        ) {
          childLogger.debug("TRUE \t Hyperion Time offset healthy");
        } else {
          childLogger.debug("FALSE \t Hyperion Time offset not configured correctly");
        }

        // RabbitMq
        if (response.data.health.find((x) => x.service === "RabbitMq" && x.status === "OK")) {
          childLogger.debug("TRUE \t Hyperion RabbitMq healthy");
        } else {
          childLogger.debug("FALSE \t Hyperion RabbitMq not healthy. Status in /v2/health should be OK");
        }

        // Elastic
        const elastic = response.data.health.find((x) => x.service === "Elasticsearch");
        if (elastic && elastic.status === "OK") {
          childLogger.debug("TRUE \t Hyperion elasticsearch healthy");
        } else {
          childLogger.debug("FALSE \t Hyperion elasticsearch not healthy. Status in /v2/health should be OK");
        }

        // Elastic - Active Shards
        if (elastic && elastic.service_data && elastic.service_data.active_shards === "100.0%") {
          childLogger.debug("TRUE \t Hyperion elasticsearch active shards 100%");
        } else {
          childLogger.debug("FALSE \t Hyperion elasticsearch active shards not 100%");
        }

        // Elastic - Total indexed blocks
        if (
          elastic &&
          elastic.service_data &&
          elastic.service_data.last_indexed_block == elastic.service_data.total_indexed_blocks
        ) {
          childLogger.debug("TRUE \t Hyperion last indexed block == total indexed block");
        } else {
          childLogger.debug("FALSE \t Hyperion Last indexed block != total indexed block");
        }
      }
    })
    .catch((error) => {
      childLogger.debug("*** FALSE *** Health not reachable");
    });

  /**
   * Test 2.2 Hyperion get_transaction
   */
  let hyperionTransactionMessage = "";
  await HttpRequest.get(
    apiEndpoint,
    "/v2/history/get_transaction?id=" + config.get((isMainnet ? "mainnet" : "testnet") + ".history_test_transaction")
  )
    .then((response) => {
      childLogger.debug("TRUE \t Hyperion transaction test passed");
      history.hyperion_transaction_ok = true;
      history.hyperion_transaction_ms = response.elapsedTimeInMilliseconds;
    })
    .catch((error) => {
      childLogger.debug("FALSE \t Hyperion transaction test not passed");
      history.hyperion_transaction_ok = false;
      hyperionTransactionMessage = error.message ? ": " + error.message : "";
    });
  pagerMessages.push(
    evaluateMessage(
      lastValidation.hyperion_transaction_ok,
      history.hyperion_transaction_ok,
      "Hyperion get_transaction test",
      "passed",
      "not passed" + hyperionTransactionMessage
    )
  );

  /**
   * Test 2.3 Hyperion get_actions
   */
  let hyperionActionsMessage = "";
  await HttpRequest.get(apiEndpoint, "/v2/history/get_actions?limit=1")
    .then((response) => {
      history.hyperion_actions_ms = response.elapsedTimeInMilliseconds;

      if (
        !(
          Array.isArray(response.data.actions) &&
          response.data.actions.length == 1 &&
          response.data.actions[0]["@timestamp"]
        )
      ) {
        childLogger.debug("FALSE \t block_time missing in last action");
        hyperionActionsMessage = ", block_time not provided";
      } else {
        let currentDate: number = Date.now();

        // Use time of http request if available in order to avoid server or validation time delay
        if (response.headers.date) {
          currentDate = new Date(response.headers.date).getTime();
        }
        // "+00:00" is necessary for defining date as UTC
        const timeDelta: number = currentDate - new Date(response.data.actions[0]["@timestamp"] + "+00:00").getTime();

        if (Math.abs(timeDelta) < 300000) {
          history.hyperion_actions_ok = true;
          childLogger.debug("TRUE \t Hyperion up-to-date");
        } else {
          childLogger.debug("FALSE \t Hyperion not up-to-date: last action is older than 5min");
          history.hyperion_actions_ok = false;
          hyperionActionsMessage += ", action is older than 5min";
        }
      }
    })
    .catch((error) => {
      childLogger.debug("FALSE \t Hyperion not up-to-date: last action is older than 5min");
      history.hyperion_actions_ok = false;
      hyperionActionsMessage = error.message ? ": " + error.message : "";
    });
  pagerMessages.push(
    evaluateMessage(
      lastValidation.hyperion_actions_ok,
      history.hyperion_actions_ok,
      "Hyperion get_actions test",
      "passed",
      "not passed" + hyperionActionsMessage
    )
  );

  /**
   * Test 2.4 Hyperion get_key_accounts
   */
  let hyperionKeyMessage = "";
  await HttpRequest.post(
    apiEndpoint,
    "/v2/state/get_key_accounts",
    '{"public_key": "' + config.get((isMainnet ? "mainnet" : "testnet") + ".history_test_public_key") + '"}'
  )
    .then((response) => {
      history.hyperion_key_accounts_ms = response.elapsedTimeInMilliseconds;
      if (response.data["account_names"]) {
        childLogger.debug("TRUE \t key account test passed");
        history.hyperion_key_accounts_ok = true;
      } else {
        childLogger.debug("FALSE \t key account test passed");
        history.hyperion_key_accounts_ok = false;
      }
    })
    .catch((error) => {
      childLogger.debug("FALSE \t key account test passed");
      history.hyperion_key_accounts_ok = false;
      hyperionKeyMessage = error.message ? ": " + error.message : "";
    });
  pagerMessages.push(
    evaluateMessage(
      lastValidation.hyperion_key_accounts_ok,
      history.hyperion_key_accounts_ok,
      "Hyperion get_key_accounts test",
      "passed",
      "not passed" + hyperionKeyMessage
    )
  );

  /**
   * Store results in Database
   */
  try {
    await database.manager.save(history);
    childLogger.info("SAVED \t New History validation to database for " + guild.name);
  } catch (error) {
    childLogger.fatal("Error while saving new History validation to database", error);
  }

  /**
   * Send Message to all subscribers of guild via. public telegram service
   */
  pagerMessages = pagerMessages.filter((message) => message);
  if (pagerMessages.length > 0)
    sendMessageHistory(
      guild.name,
      isMainnet,
      "<b>" +
        (isMainnet ? "Mainnet" : "Testnet") +
        " History results for: " +
        apiEndpoint +
        "</b> \\n" +
        pagerMessages.join("\\n")
    );

  return history;
}
