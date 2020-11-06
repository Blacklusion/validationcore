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
import * as http from "../httpConnection/newHttpRequest"

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
  locationOk: boolean,
  features: string[]
): Promise<Api> {
  // Check if valid ApiEndpoint url has been provided
  try {
    new URL(apiEndpoint)
  } catch (e) {
    return undefined;
  }


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
  await http.request(apiEndpoint, "/v1/chain/get_info", '{"json": true}')
    .then((response) => {
      api.get_info_ok = response.isOk && response.isJson();
      api.get_info_ms = response.elapsedTimeInMilliseconds;

      pagerMessages.push(
        evaluateMessage(
          lastValidation.head_block_delta_ok,
          api.head_block_delta_ok,
          "Get_info request",
          "successful",
          "not successful" + response.getFormattedErrorMessage()
        )
      );

      if (!api.get_info_ok)
        return;

      /**
       * Test 1.1: Server Version
       */
      const serverVersions: Array<string> = config.get(
        isMainnet ? "mainnet.server_versions" : "testnet.server_versions"
      );
      // todo: test code
      let serverVersion = response.data["server_version_string"] ? response.data["server_version_string"] : "unknown";
        api.server_version_ok = serverVersions.includes(serverVersion);
        api.server_version = response.data["server_version_string"];

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
        api.correct_chain = typeof response.data["chain_id"] == "string" && response.data["chain_id"] === chainId;

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
      let headBlockIncorrectMessage = "";
      if (typeof response.data["head_block_time"] == "string") {
        // Get current time
        let currentDate: number = Date.now();

        // Use time of http request if available in order to avoid server or validation time delay
        if (typeof response.headers["date"] == "number") {
          currentDate = new Date(response.headers.date).getTime();
        }

        // "+00:00" is necessary for defining date as UTC
        const timeDelta: number = currentDate - new Date(response.data["head_block_time"] + "+00:00").getTime();

        // Check if headBlock is within the allowed delta
        api.head_block_delta_ok = Math.abs(timeDelta) < config.get("validation.api_head_bock_time_delta");
        api.head_block_delta_ms = timeDelta;

        // Format message if head block delta is not within the allowed range
        if (!api.head_block_delta_ok){
          headBlockIncorrectMessage =
            ": " +
            timeDelta / 1000 +
            "sec behind. Only a delta of " +
            config.get("validation.api_head_bock_time_delta") / 1000 +
            "sec is tolerated";
        }
      } else {
        api.head_block_delta_ok = false;
        headBlockIncorrectMessage = ": could not be read from api";
      }
      pagerMessages.push(
        evaluateMessage(
          lastValidation.head_block_delta_ok,
          api.head_block_delta_ok,
          "Head block",
          "is up-to-date",
          "is not up-to-date" + headBlockIncorrectMessage
        )
      );
    })

  /**
   * Test 2: Block one exists
   */
  await http.request(apiEndpoint, "/v1/chain/get_block", '{"block_num_or_id": "1", "json": true}')
    .then((response) => {

      api.block_one_ok = response.isOk && response.isJson();
      api.block_one_ms = response.elapsedTimeInMilliseconds;

      pagerMessages.push(
        evaluateMessage(
          lastValidation.block_one_ok,
          api.block_one_ok,
          "Block one test",
          "passed",
          "not passed" + response.getFormattedErrorMessage()
        )
      );
    })

  /**
   * Test 3: Verbose Error
   */
  await http.request(apiEndpoint, "/v1/chain/should_return_error", '{"json": true}', 0)
    .then((response) => {

      api.verbose_error_ms = response.elapsedTimeInMilliseconds;
      // todo: ensure no check on undefined
      api.verbose_error_ok = !response.isOk && (Object.keys(response.data.error.details).length != 0);

      pagerMessages.push(
        evaluateMessage(
          lastValidation.verbose_error_ok,
          api.verbose_error_ok,
          "Verbose Error test",
          "passed",
          "not passed" + response.getFormattedErrorMessage()
        )
      );

    })

  /**
   * Test 4: abi serializer
   */
  if (
    config.has(isMainnet ? "mainnet" : "testnet" + ".api_test_big_block") &&
    config.has(isMainnet ? "mainnet" : "testnet" + ".api_test_big_bock_transaction_count")
  ) {
    await http.request(
      apiEndpoint,
      "/v1/chain/get_block",
      '{"json": true, "block_num_or_id": ' +
        config.get(isMainnet ? "mainnet.api_test_big_block" : "testnet.api_test_big_block") +
        "}"
    )
      .then((response) => {
        api.abi_serializer_ms = response.elapsedTimeInMilliseconds;
        api.abi_serializer_ok = response.isOk && response.data.transactions &&
          Object.keys(response.data.transactions).length ==
          config.get(
            isMainnet ? "mainnet.api_test_big_bock_transaction_count" : "testnet.api_test_big_bock_transaction_count"
          )

        pagerMessages.push(
          evaluateMessage(
            lastValidation.abi_serializer_ok,
            api.abi_serializer_ok,
            "Abi serializer test",
            "passed",
            "not passed" + response.getFormattedErrorMessage()
          )
        );
      })
  }

  /**
   * Test 5: basic symbol
   */
  await http.request(
    apiEndpoint,
    "/v1/chain/get_currency_balance",
    '{"json": true, "account": "' +
      config.get((isMainnet ? "mainnet" : "testnet") + ".api_test_account") +
      '", "code":"eosio.token", "symbol": "' +
      config.get((isMainnet ? "mainnet" : "testnet") + ".api_currency_symbol") +
      '"}'
  )
    .then((response) => {
        api.basic_symbol_ok = response.isOk && Array.isArray(response.data) && response.data.length == 1;
        api.basic_symbol_ms = response.elapsedTimeInMilliseconds;

      pagerMessages.push(
        evaluateMessage(
          lastValidation.basic_symbol_ok,
          api.basic_symbol_ok,
          "Basic symbol test",
          "passed",
          "not passed" + response.getFormattedErrorMessage()
        )
      );
    })

  /**
   * Test 6: producer api disabled
   */
    // todo
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
  // todo
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
  // todo
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
  await http.request(
    apiEndpoint,
    "/v1/chain/get_accounts_by_authorizers",
    '{"json": true, "accounts": ["' + config.get((isMainnet ? "mainnet" : "testnet") + ".api_test_account") + '"]}'
  )
    .then((response) => {
      api.wallet_accounts_ok = response.isOk && response.isJson();
      api.wallet_accounts_ms = response.elapsedTimeInMilliseconds;

      pagerMessages.push(
        evaluateMessage(
          lastValidation.wallet_accounts_ok,
          api.wallet_accounts_ok,
          "Wallet get_accounts_by_authorizers by accounts test",
          "passed",
          "not passed" + response.getFormattedErrorMessage()
        )
      );
    })

  /**
   * Test 9: Wallet - get_accounts_by_authorizers
   */
  await http.request(
    apiEndpoint,
    "/v1/chain/get_accounts_by_authorizers",
    '{"json": true, "keys": ["' + config.get((isMainnet ? "mainnet" : "testnet") + ".history_test_public_key") + '"]}'
  )
    .then((response) => {
      api.wallet_keys_ok = response.isOk && response.isJson;
      api.wallet_keys_ms = response.elapsedTimeInMilliseconds;

      pagerMessages.push(
        evaluateMessage(
          lastValidation.wallet_keys_ok,
          api.wallet_keys_ok,
          "Wallet get_accounts_by_authorizers by keys test",
          "passed",
          "not passed" + response.getFormattedErrorMessage()
        )
      );
    })

  /**
   * Set all checks ok
   * (location check is excluded, because a wrong location does not interfere with the function of an Api node
   */
  // todo: check
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
