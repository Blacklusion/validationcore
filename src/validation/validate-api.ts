import * as config from "config";
import { HttpErrorType } from "../httpConnection/HttpErrorType";
import * as ValidateHistory from "./validate-history";
import { logger } from "../common";
import { Guild } from "../database/entity/Guild";
import { Api } from "../database/entity/Api";
import { getConnection } from "typeorm";
import { Logger } from "tslog";
import { sendMessageApi } from "../telegramHandler";
import * as http from "../httpConnection/HttpRequest";
import { evaluateMessage, convertArrayToJson } from "../messageHandler";

/**
 * Logger Settings for Api
 */
const childLogger: Logger = logger.getChildLogger({
  name: "Api-Validation",
  displayFilePath: "hidden",
  displayLoggerName: true,
});

/**
 * Performs all validations for an Api-Node
 * @param {Guild} guild = guild for which the Api is validated (must be tracked in database)
 * @param {Boolean} isMainnet = only either testnet or mainnet is validated. If set to true, Mainnet will be validated
 * @param {Api} lastValidation = last validation of the SAME Api Endpoint
 * @param {string} apiEndpoint = url of the api node (http and https possible)
 * @param {boolean} isSsl = if true, it is also validated if TLS is working. Then the Api will only be considered healthy, if all checks pass and if TLS is working
 * @param {boolean} locationOk = states if the location information found in the bp.json is valid
 * @param {string[]} features = Array of features supplied in the bp.json, describing which features the Api should support
 */
export async function validateAll(
  guild: Guild,
  isMainnet: boolean,
  lastValidation: Api,
  apiEndpoint: string,
  isSsl: boolean,
  locationOk: boolean,
  features: string[]
): Promise<[Api, any, any]> {
  // Check if valid ApiEndpoint url has been provided
  try {
    new URL(apiEndpoint);
  } catch (e) {
    return undefined;
  }

  // Counts how many requests have failed. If performance mode is enabled, future requests may not be performed, if to many requests already failed
  let failedRequestCounter = 0;

  // Set general variables
  const chainId = isMainnet ? config.get("mainnet.chain_id") : config.get("testnet.chain_id");
  const validationMessages: Array<[string, number]> = [];

  // Create api object for database
  const database = getConnection();
  const api: Api = new Api();
  api.guild = guild.name;
  api.location_ok = locationOk;
  api.api_endpoint = apiEndpoint;
  api.validation_is_mainnet = isMainnet;

  // Create dummy api object if lastValidation is undefined
  if (!lastValidation) lastValidation = new Api();

  /**
   * SSL Check
   */
  api.is_ssl = isSsl;
  if (isSsl) {
    let sslMessage = "";
    if (!new RegExp("https://.+").test(apiEndpoint)) {
      api.ssl_ok = false;
      sslMessage = "not ok, no https url provided";
    } else {
      await http.get(apiEndpoint, "", 0).then((response) => {
        if (response.ok || (!response.ok && response.errorType === HttpErrorType.HTTP)) {
          api.ssl_ok = true;
        } else {
          api.ssl_ok = false;
          sslMessage = "not ok: " + response.getFormattedErrorMessage();
        }
      });
    }
    validationMessages.push(evaluateMessage(lastValidation.ssl_ok, api.ssl_ok, "TLS", "ok", sslMessage));

    if (!api.ssl_ok) failedRequestCounter++;
  }

  /**
   * 1. Test: Basic Checks
   */
  await http
    .post(apiEndpoint, "/v1/chain/get_info", { json: true }, http.evaluatePerformanceMode(failedRequestCounter))
    .then((response) => {
      api.get_info_ok = response.ok && response.isJson();
      api.get_info_ms = response.elapsedTimeInMilliseconds;

      validationMessages.push(
        evaluateMessage(
          lastValidation.get_info_ok,
          api.get_info_ok,
          "Get_info request",
          "successful",
          "not successful" + response.getFormattedErrorMessage()
        )
      );

      if (!api.get_info_ok) {
        failedRequestCounter++;
        return;
      }

      /**
       * Test 1.1: Server Version
       */
      const serverVersions: Array<string> = config.get(
        isMainnet ? "mainnet.server_versions" : "testnet.server_versions"
      );
      const serverVersion = response.getDataItem(["server_version_string"])
        ? response.getDataItem(["server_version_string"])
        : "unknown";
      api.server_version_ok = serverVersions.includes(serverVersion);
      api.server_version = response.getDataItem(["server_version_string"]);

      validationMessages.push(
        evaluateMessage(
          lastValidation.server_version_ok,
          api.server_version_ok,
          "Server version " + serverVersion + " is",
          "valid",
          "invalid"
        )
      );

      /**
       * Test 1.2: Api for correct chain
       */
      api.correct_chain =
        typeof response.getDataItem(["chain_id"]) === "string" && response.getDataItem(["chain_id"]) === chainId;

      validationMessages.push(
        evaluateMessage(
          lastValidation.correct_chain,
          api.correct_chain,
          "Api is provided for the",
          "correct chain",
          "wrong chain"
        )
      );

      /**
       * Test 1.3: Head Block up to date
       */
      let headBlockIncorrectMessage = "";
      if (typeof response.getDataItem(["head_block_time"]) === "string") {
        // Get current time
        let currentDate: number = Date.now();

        // Use time of http request if available in order to avoid server or validation time delay
        if (typeof response.headers.get("date") === "number") {
          currentDate = new Date(response.headers.get("date")).getTime();
        }

        // "+00:00" is necessary for defining date as UTC
        const timeDelta: number =
          currentDate - new Date(response.getDataItem(["head_block_time"]) + "+00:00").getTime();

        // Check if headBlock is within the allowed delta
        api.head_block_delta_ok = Math.abs(timeDelta) < config.get("validation.api_head_block_time_delta");
        api.head_block_delta_ms = timeDelta;

        // Format message if head block delta is not within the allowed range
        if (!api.head_block_delta_ok) {
          headBlockIncorrectMessage =
            ": " +
            timeDelta / 1000 +
            "sec behind. Only a delta of " +
            config.get("validation.api_head_block_time_delta") / 1000 +
            "sec is tolerated";
        }
      } else {
        api.head_block_delta_ok = false;
        headBlockIncorrectMessage = ": could not be read from api";
      }
      validationMessages.push(
        evaluateMessage(
          lastValidation.head_block_delta_ok,
          api.head_block_delta_ok,
          "Head block",
          "is up-to-date",
          "is not up-to-date" + headBlockIncorrectMessage
        )
      );
    });

  /**
   * Test 2: Block one exists
   */
  await http
    .post(
      apiEndpoint,
      "/v1/chain/get_block",
      { block_num_or_id: 1, json: true },
      http.evaluatePerformanceMode(failedRequestCounter)
    )
    .then((response) => {
      api.block_one_ok = response.ok && response.isJson();
      api.block_one_ms = response.elapsedTimeInMilliseconds;

      validationMessages.push(
        evaluateMessage(
          lastValidation.block_one_ok,
          api.block_one_ok,
          "Block one test",
          "passed",
          "not passed" + response.getFormattedErrorMessage()
        )
      );

      if (!api.block_one_ok) failedRequestCounter++;
    });

  /**
   * Test 3: Verbose Error
   */
  await http.post(apiEndpoint, "/v1/chain/should_return_error", { json: true }, 0).then((response) => {
    api.verbose_error_ms = response.elapsedTimeInMilliseconds;
    // todo: ensure no check on undefined
    api.verbose_error_ok =
      !response.ok && response.isJson() && Object.keys(response.getDataItem(["error", "details"])).length != 0;
    validationMessages.push(
      evaluateMessage(
        lastValidation.verbose_error_ok,
        api.verbose_error_ok,
        "Verbose Error test",
        "passed",
        "not passed" + response.getFormattedErrorMessage()
      )
    );

    if (!api.verbose_error_ok) failedRequestCounter++;
  });

  /**
   * Test 4: abi serializer
   */
  if (
    config.has(isMainnet ? "mainnet" : "testnet" + ".api_test_big_block") &&
    config.has(isMainnet ? "mainnet" : "testnet" + ".api_test_big_block_transaction_count")
  ) {
    await http
      .post(
        apiEndpoint,
        "/v1/chain/get_block",
        {
          json: true,
          block_num_or_id: config.get(isMainnet ? "mainnet.api_test_big_block" : "testnet.api_test_big_block"),
        },
        http.evaluatePerformanceMode(failedRequestCounter)
      )
      .then((response) => {
        api.abi_serializer_ms = response.elapsedTimeInMilliseconds;
        api.abi_serializer_ok =
          response.ok &&
          response.getDataItem(["transactions"]) &&
          Object.keys(response.getDataItem(["transactions"])).length ==
            config.get(
              isMainnet
                ? "mainnet.api_test_big_block_transaction_count"
                : "testnet.api_test_big_block_transaction_count"
            );

        validationMessages.push(
          evaluateMessage(
            lastValidation.abi_serializer_ok,
            api.abi_serializer_ok,
            "Abi serializer test",
            "passed",
            "not passed" + response.getFormattedErrorMessage()
          )
        );

        if (!api.abi_serializer_ok) failedRequestCounter++;
      });
  }

  /**
   * Test 5: basic symbol
   */
  await http
    .post(
      apiEndpoint,
      "/v1/chain/get_currency_balance",
      {
        json: true,
        account: config.get((isMainnet ? "mainnet" : "testnet") + ".api_test_account"),
        code: "eosio.token",
        symbol: config.get((isMainnet ? "mainnet" : "testnet") + ".api_currency_symbol"),
      },
      http.evaluatePerformanceMode(failedRequestCounter)
    )
    .then((response) => {
      api.basic_symbol_ok = response.ok && Array.isArray(response.dataJson) && response.dataJson.length == 1;
      api.basic_symbol_ms = response.elapsedTimeInMilliseconds;

      validationMessages.push(
        evaluateMessage(
          lastValidation.basic_symbol_ok,
          api.basic_symbol_ok,
          "Basic symbol test",
          "passed",
          "not passed" + response.getFormattedErrorMessage()
        )
      );

      if (!api.basic_symbol_ok) failedRequestCounter++;
    });

  /**
   * Test 6: producer api disabled
   */
  await http.get(apiEndpoint, "/v1/producer/get_integrity_hash", 0).then((response) => {
    // Set status in database
    api.producer_api_ms = response.elapsedTimeInMilliseconds;
    // Test should be successful if a html page is returned, hence !response.isJson()
    api.producer_api_off =
      (!response.ok && response.errorType === HttpErrorType.HTTP && response.httpCode > 100) || !response.isJson();

    // Create error message
    let producerApiIncorrectMessage = "is enabled. This feature should be disabled";
    if (!response.ok && response.errorType !== HttpErrorType.HTTP) {
      producerApiIncorrectMessage = "could not be validated" + response.getFormattedErrorMessage();
    }

    validationMessages.push(
      evaluateMessage(
        lastValidation.producer_api_off,
        api.producer_api_off,
        "Producer api",
        "is disabled",
        producerApiIncorrectMessage
      )
    );

    if (!api.producer_api_off) failedRequestCounter++;
  });

  /**
   * Test 7: db_size api disabled
   */
  await http.get(apiEndpoint, "/v1/db_size/get", 0).then((response) => {
    // Set status in database
    api.db_size_api_ms = response.elapsedTimeInMilliseconds;
    // Test should be successful if a html page is returned, hence !response.isJson()
    api.db_size_api_off =
      (!response.ok && response.errorType === HttpErrorType.HTTP && response.httpCode > 100) || !response.isJson();

    // Create error message
    let dbSizeIncorrectMessage = "is enabled. This feature should be disabled";
    if (!response.ok && response.errorType !== HttpErrorType.HTTP) {
      dbSizeIncorrectMessage = "could not be validated" + response.getFormattedErrorMessage();
    }

    validationMessages.push(
      evaluateMessage(
        lastValidation.db_size_api_off,
        api.db_size_api_off,
        "Db_size api",
        "is disabled",
        dbSizeIncorrectMessage
      )
    );

    if (!api.db_size_api_off) failedRequestCounter++;
  });

  /**
   * Test 8: net api disabled
   */
  await http.get(apiEndpoint, "/v1/net/connections", 0).then((response) => {
    // Set status in database
    api.net_api_ms = response.elapsedTimeInMilliseconds;
    // Test should be successful if a html page is returned, hence !response.isJson()
    api.net_api_off =
      (!response.ok && response.errorType === HttpErrorType.HTTP && response.httpCode > 100) || !response.isJson();

    // Create error message
    let netApiIncorrectMessage = "is enabled. This feature should be disabled";
    if (!response.ok && response.errorType !== HttpErrorType.HTTP) {
      netApiIncorrectMessage = "could not be validated" + response.getFormattedErrorMessage();
    }

    validationMessages.push(
      evaluateMessage(lastValidation.net_api_off, api.net_api_off, "Net api", "is disabled", netApiIncorrectMessage)
    );

    if (!api.net_api_off) failedRequestCounter++;
  });

  /**
   * Test 9: Wallet - get_accounts_by_authorizers
   */
  await http
    .post(
      apiEndpoint,
      "/v1/chain/get_accounts_by_authorizers",
      {
        json: true,
        accounts: [config.get((isMainnet ? "mainnet" : "testnet") + ".api_test_account")],
      },
      http.evaluatePerformanceMode(failedRequestCounter)
    )
    .then((response) => {
      api.wallet_accounts_ok = response.ok && response.isJson();
      api.wallet_accounts_ms = response.elapsedTimeInMilliseconds;

      validationMessages.push(
        evaluateMessage(
          lastValidation.wallet_accounts_ok,
          api.wallet_accounts_ok,
          "Wallet get_accounts_by_authorizers by accounts test",
          "passed",
          "not passed" + response.getFormattedErrorMessage()
        )
      );

      if (!api.wallet_accounts_ok) failedRequestCounter++;
    });

  /**
   * Test 9: Wallet - get_accounts_by_authorizers
   */
  await http
    .post(
      apiEndpoint,
      "/v1/chain/get_accounts_by_authorizers",
      {
        json: true,
        keys: [config.get((isMainnet ? "mainnet" : "testnet") + ".history_test_public_key")],
      },
      http.evaluatePerformanceMode(failedRequestCounter)
    )
    .then((response) => {
      api.wallet_keys_ok = response.ok && response.isJson();
      api.wallet_keys_ms = response.elapsedTimeInMilliseconds;

      validationMessages.push(
        evaluateMessage(
          lastValidation.wallet_keys_ok,
          api.wallet_keys_ok,
          "Wallet get_accounts_by_authorizers by keys test",
          "passed",
          "not passed" + response.getFormattedErrorMessage()
        )
      );

      if (!api.wallet_keys_ok) failedRequestCounter++;
    });

  api.wallet_all_checks_ok = api.wallet_accounts_ok && api.wallet_keys_ok;

  /**
   * Set all checks ok
   * (location check is excluded, because a wrong location does not interfere with the function of an Api node
   */
  // An unpleasant solution, however simplifying this into a single line would cause sideeffects with undefined. This ensures the result will always be a boolean
  if (
    api.server_version_ok &&
    api.correct_chain &&
    api.head_block_delta_ok &&
    api.block_one_ok &&
    api.block_one_ok &&
    api.verbose_error_ok &&
    (config.has(isMainnet ? "mainnet" : "testnet" + ".api_test_big_block") &&
    config.has(isMainnet ? "mainnet" : "testnet" + ".api_test_big_block_transaction_count")
      ? api.abi_serializer_ok
      : true) &&
    api.basic_symbol_ok &&
    api.producer_api_off &&
    api.db_size_api_off &&
    api.net_api_off
  ) {
    api.all_checks_ok = true;
  } else {
    api.all_checks_ok = false;
  }

  /**
   * Test History
   */

  let history;
  if (api.all_checks_ok) {
    history = await ValidateHistory.validateAll(
      guild,
      isMainnet,
      lastValidation.history_validation,
      apiEndpoint,
      isSsl
    );

    if (Array.isArray(history) && history[0]) {
      api.history_validation = history[0];
    }
  }

  /**
   * Validate if supplied features in bp.json are actually supported by Api
   */
  api.bp_json_all_features_ok = false;
  let featuresIncorrectMessage = "were not provided";
  if (features !== undefined) {
    featuresIncorrectMessage = "not ok";
    api.bp_json_all_features_ok = true;

    const testedFeatures: [string, boolean][] = [
      ["chain-api", api.all_checks_ok],
      ["account-query", api.wallet_all_checks_ok],
      ["history-v1", api.history_validation !== undefined && api.history_validation.history_all_checks_ok],
      ["hyperion-v2", api.history_validation !== undefined && api.history_validation.hyperion_all_checks_ok],
    ];

    testedFeatures.forEach((feature) => {
      if (features.includes(feature[0])) {
        if (!feature[1]) {
          api.bp_json_all_features_ok = false;
          featuresIncorrectMessage += ', "' + feature[0] + '" (not working, but was included in features array)';
        }
      } else {
        if (feature[1]) {
          api.bp_json_all_features_ok = false;
          featuresIncorrectMessage += ', "' + feature[0] + '" (working, but was not not included in features array)';
        }
      }
    });
  }

  validationMessages.push(
    evaluateMessage(
      lastValidation.bp_json_all_features_ok,
      api.bp_json_all_features_ok,
      "Supplied features in bp.json are",
      "ok",
      featuresIncorrectMessage
    )
  );

  validationMessages.push(
    evaluateMessage(lastValidation.all_checks_ok, api.all_checks_ok, "Chain Api", "healthy", "not healthy")
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.wallet_all_checks_ok,
      api.wallet_all_checks_ok,
      "Account Query Api is",
      "healthy",
      "not healthy"
    )
  );

  /**
   * Store results in Database
   */
  try {
    await database.manager.save(api);
    childLogger.debug(
      "SAVED \t New Api validation to database for " +
        guild.name +
        " " +
        (isMainnet ? "mainnet" : "testnet") +
        " to database"
    );
  } catch (error) {
    childLogger.fatal("Error while saving new Api validation to database", error);
  }

  /**
   * Send Message to all subscribers of guild via. public telegram service
   */
  sendMessageApi(guild.name, isMainnet, apiEndpoint, validationMessages);

  return [
    api,
    convertArrayToJson(validationMessages, apiEndpoint),
    Array.isArray(history) && history.length == 2 ? history[1] : undefined,
  ];
}
