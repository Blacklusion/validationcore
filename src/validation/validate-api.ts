import * as HttpRequest from "../httpConnection/HttpRequest";
import * as config from "config";
import { HttpErrorType } from "../httpConnection/HttpErrorType";
import * as ValidateHistory from "./validate-history";
import { logger } from "../common";
import { Guild } from "../database/entity/Guild";
import { Api } from "../database/entity/Api";
import { getConnection } from "typeorm";
import { Logger } from "tslog";
import { evaluateMessage, sendMessageApi } from "../telegramHandler";

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
 * @param guild
 * @param isMainnet
 * @param lastValidation
 * @param apiEndpoint = of the api node (http and https possible) that is being tested
 * @param locationOk = states if the location information found in the bp.json is valid
 */
export async function validateAll(
  guild: Guild,
  isMainnet: boolean,
  lastValidation: Api,
  apiEndpoint: string,
  isSsl: boolean,
  locationOk: boolean
): Promise<Api> {
  if (!apiEndpoint) return undefined;

  // Set general variables
  const chainId = isMainnet ? config.get("mainnet.chain_id") : config.get("testnet.chain_id");
  let pagerMessages: Array<[string, boolean]> = [];

  // Create api object for database
  const database = getConnection();
  const api: Api = new Api();
  api.guild = guild.name;
  api.location_ok = locationOk;
  api.api_endpoint = apiEndpoint;

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
      await HttpRequest.get(apiEndpoint, "", 0)
        .then((response) => {
          api.ssl_ok = true;
        })
        .catch((error) => {
          if (error.type == HttpErrorType.HTTP) {
            api.ssl_ok = true;
          } else if (error.type == HttpErrorType.SSL) {
            sslMessage = "not ok: " + error.message;
            api.ssl_ok = false;
          } else {
            sslMessage = "could not be validated" + (error.message ? ": " + error.message : "");
            api.ssl_ok = false;
          }
        });
    }
    pagerMessages.push(evaluateMessage(lastValidation.ssl_ok, api.ssl_ok, "TLS", "ok", sslMessage));
  }

  /**
   * 1. Test: Basic Checks
   */
  let getInfoMessage = "";
  await HttpRequest.post(apiEndpoint, "/v1/chain/get_info", '{"json": true}')
    .then((response) => {
      api.get_info_ok = response.isJson;
      api.get_info_ms = response.elapsedTimeInMilliseconds;

      /**
       * Test 1.1: Server Version
       */
      const serverVersions: Array<string> = config.get(
        isMainnet ? "mainnet.server_versions" : "testnet.server_versions"
      );
      let serverVersion = response.data["server_version_string"] ? response.data["server_version_string"] : "unknown";
      if (serverVersions.includes(serverVersion)) {
        childLogger.debug("TRUE \t Node running correct Server Version");
        api.server_version_ok = true;
        serverVersion = response.data["server_version_string"];
        api.server_version = serverVersion;
      } else {
        childLogger.debug("FALSE \t Server is not running correct Server Version");
        api.server_version_ok = false;
      }
      pagerMessages.push(
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
      if (typeof response.data["chain_id"] == "string" && response.data["chain_id"] === chainId) {
        childLogger.debug("TRUE \t Provided Api for correct Chain");
        api.correct_chain = true;
      } else {
        childLogger.debug("FALSE \t Provided Api for wrong Chain");
        api.correct_chain = false;
      }
      pagerMessages.push(
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
      let heaadBlockmessage = "";
      if (typeof response.data["head_block_time"] == "string") {
        let currentDate: number = Date.now();

        // Use time of http request if available in order to avoid server or validation time delay
        if (typeof response.headers["date"] == "number") {
          currentDate = new Date(response.headers.date).getTime();
        }

        // "+00:00" is necessary for defining date as UTC
        const timeDelta: number = currentDate - new Date(response.data["head_block_time"] + "+00:00").getTime();
        if (Math.abs(timeDelta) < config.get("validation.api_head_bock_time_delta")) {
          childLogger.debug("TRUE \t Head Block is up to date; Delta: " + timeDelta);
          api.head_block_delta_ok = true;
          api.head_block_delta_ms = timeDelta;
        } else {
          childLogger.debug("FALSE \t Head Block not up to date; Delta: " + timeDelta);
          api.head_block_delta_ok = false;
          heaadBlockmessage =
            ": " +
            timeDelta / 1000 +
            "sec behind. Only a delta of " +
            config.get("validation.api_head_bock_time_delta") / 1000 +
            "sec is tolerated";
        }
      } else {
        childLogger.debug("FALSE \t NO Head block time provided");
        api.head_block_delta_ok = false;
        heaadBlockmessage = ": could not be read from api";
      }
      pagerMessages.push(
        evaluateMessage(
          lastValidation.head_block_delta_ok,
          api.head_block_delta_ok,
          "Head block",
          "is up-to-date",
          "is not up-to-date" + heaadBlockmessage
        )
      );
    })
    .catch((error) => {
      childLogger.debug("FALSE \t /v1/chain/get_info not reachable", error);
      api.get_info_ok = false;
      getInfoMessage = error.message ? ": " + error.message : "";
    });
  pagerMessages.push(
    evaluateMessage(
      lastValidation.head_block_delta_ok,
      api.head_block_delta_ok,
      "Get_info request",
      "successful",
      "not successful" + getInfoMessage
    )
  );

  /**
   * Test 2: Block one exists
   */
  let blockOneMessage = "";
  await HttpRequest.post(apiEndpoint, "/v1/chain/get_block", '{"block_num_or_id": "1", "json": true}')
    .then((response) => {
      childLogger.debug("TRUE \t Block One is available");
      api.block_one_ok = response.isJson;
      api.block_one_ms = response.elapsedTimeInMilliseconds;
      if (!response.isJson) blockOneMessage = ": invalid Json formatting";
    })
    .catch((error) => {
      childLogger.debug("FALSE \t Block One is not available", error);
      api.block_one_ok = false;
      blockOneMessage = error.message ? ": " + error.message : "";
    });
  pagerMessages.push(
    evaluateMessage(
      lastValidation.block_one_ok,
      api.block_one_ok,
      "Block one test",
      "passed",
      "not passed" + blockOneMessage
    )
  );

  /**
   * Test 3: Verbose Error
   */
  let verboseErrorMessage = "";
  await HttpRequest.post(apiEndpoint, "/v1/chain/should_return_error", '{"json": true}', 0)
    .then((response) => {
      // childLogger.debug("FALSE \t Verbose error test not passed");
      // api.verbose_error_ok = false;#
      throw new Error();
    })
    .catch((error) => {
      try {
        if (Object.keys(error.response.data.error.details).length != 0) {
          childLogger.debug("TRUE \t Verbose error test passed");
          api.verbose_error_ok = true;
          api.verbose_error_ms = error.response.elapsedTimeInMilliseconds;
        } else {
          throw new Error();
        }
      } catch (e) {
        childLogger.debug("FALSE \t Verbose error test not passed", error);
        api.verbose_error_ok = false;

        if (error.message) verboseErrorMessage = ": " + error.message;
      }
    });
  pagerMessages.push(
    evaluateMessage(
      lastValidation.verbose_error_ok,
      api.verbose_error_ok,
      "Verbose Error test",
      "passed",
      "not passed" + verboseErrorMessage
    )
  );

  /**
   * Test 4: abi serializer
   */
  if (
    config.has(isMainnet ? "mainnet" : "testnet" + ".api_test_big_block") &&
    config.has(isMainnet ? "mainnet" : "testnet" + ".api_test_big_bock_transaction_count")
  ) {
    let abiErrorMessage = "";
    await HttpRequest.post(
      apiEndpoint,
      "/v1/chain/get_block",
      '{"json": true, "block_num_or_id": ' +
        config.get(isMainnet ? "mainnet.api_test_big_block" : "testnet.api_test_big_block") +
        "}"
    )
      .then((response) => {
        if (
          response.data.transactions &&
          Object.keys(response.data.transactions).length ==
            config.get(
              isMainnet ? "mainnet.api_test_big_bock_transaction_count" : "testnet.api_test_big_bock_transaction_count"
            )
        ) {
          childLogger.debug("TRUE \t Abi serializer test passed");
          api.abi_serializer_ok = true;
          api.abi_serializer_ms = response.elapsedTimeInMilliseconds;
        } else {
          childLogger.debug(
            "FALSE \t Abi serializer test not passed: Transaction count does not match expected count."
          );
          api.abi_serializer_ok = false;
        }
      })
      .catch((error) => {
        childLogger.debug("FALSE \t Abi serializer test not passed", error);
        api.abi_serializer_ok = false;
        abiErrorMessage = ": " + error.message;
      });
    pagerMessages.push(
      evaluateMessage(
        lastValidation.abi_serializer_ok,
        api.abi_serializer_ok,
        "Abi serializer test",
        "passed",
        "not passed" + abiErrorMessage
      )
    );
  }

  /**
   * Test 5: basic symbol
   */
  let basicSymbolMessage = "";
  await HttpRequest.post(
    apiEndpoint,
    "/v1/chain/get_currency_balance",
    '{"json": true, "account": "' +
      config.get((isMainnet ? "mainnet" : "testnet") + ".api_test_account") +
      '", "code":"eosio.token", "symbol": "' +
      config.get((isMainnet ? "mainnet" : "testnet") + ".api_currency_symbol") +
      '"}'
  )
    .then((response) => {
      if (Array.isArray(response.data) && response.data.length == 1) {
        childLogger.debug("TRUE \t Basic Symbol check passed");
        api.basic_symbol_ok = true;
        api.basic_symbol_ms = response.elapsedTimeInMilliseconds;
      } else {
        childLogger.debug("FALSE \t Basic Symbol check not passed");
        api.basic_symbol_ok = false;
      }
    })
    .catch((error) => {
      childLogger.debug("FALSE \t Basic Symbol check not passed", error);
      api.basic_symbol_ok = false;
      basicSymbolMessage = error.message ? ": " + error.message : "";
    });
  pagerMessages.push(
    evaluateMessage(
      lastValidation.basic_symbol_ok,
      api.basic_symbol_ok,
      "Basic symbol test",
      "passed",
      "not passed" + basicSymbolMessage
    )
  );

  /**
   * Test 6: producer api disabled
   */
  let producerApiMessage = "";
  await HttpRequest.get(apiEndpoint, "/v1/producer/get_integrity_hash", 0)
    .then((response) => {
      childLogger.debug("FALSE \t Producer api not disabled");
      api.producer_api_off = !response.isJson;
      producerApiMessage = "is enabled. This feature should be disabled";
    })
    .catch((error) => {
      if (error.type == HttpErrorType.HTTP && error.code > 100) {
        childLogger.debug("TRUE \t Producer api disabled");
        api.producer_api_off = true;
        api.producer_api_ms = error.response.elapsedTimeInMilliseconds;
      } else {
        childLogger.debug("FALSE \t Producer api not disabled", error);
        api.producer_api_off = false;
        producerApiMessage = "could not be validated" + (error.message ? ": " + error.message : "");
      }
    });
  pagerMessages.push(
    evaluateMessage(
      lastValidation.producer_api_off,
      api.producer_api_off,
      "Producer api",
      "is disabled",
      producerApiMessage
    )
  );

  /**
   * Test 7: db_size api disabled
   */
  let dbSizeMessage = "";
  await HttpRequest.get(apiEndpoint, "/v1/db_size/get", 0)
    .then((response) => {
      childLogger.debug("FALSE \t db size api not disabled");
      api.db_size_api_off = !response.isJson;
      dbSizeMessage = "is enabled. This feature should be disabled";
    })
    .catch((error) => {
      if (error.type == HttpErrorType.HTTP && error.code > 100) {
        childLogger.debug("TRUE \t db size api disabled");
        api.db_size_api_off = true;
        api.db_size_api_ms = error.response.elapsedTimeInMilliseconds;
      } else {
        childLogger.debug("FALSE \t db size api not disabled", error);
        api.db_size_api_off = false;
        dbSizeMessage = "could not be validated" + (error.message ? ": " + error.message : "");
      }
    });
  pagerMessages.push(
    evaluateMessage(lastValidation.db_size_api_off, api.db_size_api_off, "Db_size api", "is disabled", dbSizeMessage)
  );

  /**
   * Test 8: net api disabled
   */
  let netApiMessage = "";
  await HttpRequest.get(apiEndpoint, "/v1/net/connections", 0)
    .then((response) => {
      childLogger.debug("FALSE \t net api not disabled");
      api.net_api_off = !response.isJson;
      netApiMessage = "is enabled. This feature should be disabled";
    })
    .catch((error) => {
      if (error.type == HttpErrorType.HTTP && error.code > 100) {
        api.net_api_off = true;
        api.net_api_ms = error.response.elapsedTimeInMilliseconds;
        childLogger.debug("TRUE \t net api disabled");
      } else {
        childLogger.debug("FALSE \t net api not disabled", error);
        api.net_api_off = false;
        netApiMessage = "could not be validated" + (error.message ? ": " + error.message : "");
      }
    });
  pagerMessages.push(
    evaluateMessage(lastValidation.net_api_off, api.net_api_off, "Net api", "is disabled", netApiMessage)
  );

  /**
   * Test 9: Wallet - get_accounts_by_authorizers
   */
  let walletAccountsMessage = "";
  await HttpRequest.post(
    apiEndpoint,
    "/v1/chain/get_accounts_by_authorizers",
    '{"json": true, "accounts": ["' + config.get((isMainnet ? "mainnet" : "testnet") + ".api_test_account") + '"]}'
  )
    .then((response) => {
      childLogger.debug("TRUE \t get_accounts_by_authorizers by accounts test passed");
      api.wallet_accounts_ok = response.isJson;
      api.wallet_accounts_ms = response.elapsedTimeInMilliseconds;
    })
    .catch((error) => {
      childLogger.debug("FALSE \t get_accounts_by_authorizers by accounts test not passed");
      api.wallet_accounts_ok = false;
      walletAccountsMessage = error.message ? ": " + error.message : "";
    });
  pagerMessages.push(
    evaluateMessage(
      lastValidation.wallet_accounts_ok,
      api.wallet_accounts_ok,
      "Wallet get_accounts_by_authorizers by accounts test",
      "passed",
      "not passed" + walletAccountsMessage
    )
  );

  /**
   * Test 9: Wallet - get_accounts_by_authorizers
   */
  let walletKeysMessage = "";
  await HttpRequest.post(
    apiEndpoint,
    "/v1/chain/get_accounts_by_authorizers",
    '{"json": true, "keys": ["' + config.get((isMainnet ? "mainnet" : "testnet") + ".history_test_public_key") + '"]}'
  )
    .then((response) => {
      childLogger.debug("TRUE \t get_accounts_by_authorizers by keys test passed");
      api.wallet_keys_ok = response.isJson;
      api.wallet_keys_ms = response.elapsedTimeInMilliseconds;
    })
    .catch((error) => {
      childLogger.debug("FALSE \t get_accounts_by_authorizers by keys test not passed");
      api.wallet_keys_ok = false;
      walletKeysMessage = error.message ? ": " + error.message : "";
    });
  pagerMessages.push(
    evaluateMessage(
      lastValidation.wallet_keys_ok,
      api.wallet_keys_ok,
      "Wallet get_accounts_by_authorizers by keys test",
      "passed",
      "not passed" + walletKeysMessage
    )
  );

  /**
   * Set all checks ok
   * (location check is excluded, because a wrong location does not interfere with the function of an Api node
   */
  api.all_checks_ok =
    api.server_version_ok &&
    api.correct_chain &&
    api.head_block_delta_ok &&
    api.block_one_ok &&
    api.block_one_ok &&
    api.verbose_error_ok &&
    api.abi_serializer_ok &&
    api.basic_symbol_ok &&
    api.producer_api_off &&
    api.db_size_api_off &&
    api.net_api_off;

  /**
   * Test History
   */

  if (api.all_checks_ok) {
    const history = await ValidateHistory.validateAll(
      guild,
      isMainnet,
      lastValidation.history_validation,
      apiEndpoint,
      isSsl
    );

    if (history) {
      api.history_validation = history;
    }
  }

  /**
   * Store results in Database
   */
  try {
    await database.manager.save(api);
    childLogger.info("SAVED \t New Api validation to database for " + guild.name);
  } catch (error) {
    childLogger.fatal("Error while saving new Api validation to database", error);
  }

  /**
   * Send Message to all subscribers of guild via. public telegram service
   */
  pagerMessages = pagerMessages.filter((message) => message);
  if (pagerMessages.length > 0)
    sendMessageApi(
      guild.name,
      isMainnet,
      apiEndpoint,
      pagerMessages
    );

  return api;
}
