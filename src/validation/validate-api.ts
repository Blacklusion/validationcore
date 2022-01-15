import * as config from "config";
import { HttpErrorType } from "../validationcore-database-scheme/enum/HttpErrorType";
import { Guild } from "../validationcore-database-scheme/entity/Guild";
import { NodeApi } from "../validationcore-database-scheme/entity/NodeApi";
import { getConnection } from "typeorm";
import { Logger } from "tslog";
import * as http from "../httpConnection/HttpRequest";
import { isURL } from "validator";
import { ValidationLevel } from "../validationcore-database-scheme/enum/ValidationLevel";
import {
  allChecksOK,
  calculateValidationLevel, extractLatitude, extractLongitude,
  logger,
  validateBpLocation
} from "../validationcore-database-scheme/common";
import { getChainsConfigItem, serverVersionsConfig } from "../validationcore-database-scheme/readConfig";

/**
 * Logger Settings for NodeApi
 */
const childLogger: Logger = logger.getChildLogger({
  name: "Api-Validation",
  displayFilePath: "hidden",
  displayLoggerName: true,
});

/**
 * Performs all validations for an NodeApi-Node
 * @param {Guild} guild = guild for which the NodeApi is validated (must be tracked in database)
 * @param {string} chainId = chainId of chain that is validated
 * @param {string} endpointUrl = url of the api node (http and https possible)
 * @param {boolean} isSSL = if true, it is also validated if TLS is working. Then the NodeApi will only be considered healthy, if all checks pass and if TLS is working
 * @param {unknown} location = location information as in bp.json
 */
export async function validateApi(
  guild: Guild,
  chainId: string,
  endpointUrl: string,
  isSSL: boolean,
  location: unknown
): Promise<NodeApi> {
  if (!endpointUrl) return undefined;

  // Counts how many requests have failed. If performance mode is enabled, future requests may not be performed, if to many requests already failed
  let failedRequestCounter = 0;

  // Create api object for database
  const database = getConnection(chainId);
  const api: NodeApi = new NodeApi();
  api.instance_id = config.get("general.instance_id")
  api.guild = guild.name;
  api.endpoint_url = endpointUrl;
  api.is_ssl = isSSL;


  if (getChainsConfigItem(chainId, "nodeApi_location")) {
    api.location_ok = calculateValidationLevel(validateBpLocation(location), chainId, "nodeApi_location_level");
    api.location_longitude = extractLongitude(location);
    api.location_latitude = extractLatitude(location);
  }

  // Check if valid EndpointUrl has been provided
  if (getChainsConfigItem(chainId, "nodeApi_endpoint_url_ok")) {
    const endpointUrlOk = isURL(endpointUrl, {
      require_protocol: true,
    });

    api.endpoint_url_ok = calculateValidationLevel(endpointUrlOk, chainId, "nodeApi_endpoint_url_ok_level");
  }

  /**
   * 1. Test: Basic Checks
   */
  if (getChainsConfigItem(chainId, "nodeApi_get_info")) {
    await http
      .request(endpointUrl, "nodeApi_get_info", chainId, failedRequestCounter)
      .then((response) => {

        /**
         * SSL Check
         */
        if (isSSL && getChainsConfigItem(chainId, "nodeApi_ssl")) {
          http.evaluateSSL(endpointUrl, response.ok, response.errorType).then((response) => {
            api.ssl_ok = calculateValidationLevel(response.ok, chainId, "nodeApi_ssl_level");
            api.ssl_errortype = response.errorType;
            if (api.ssl_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
          });
        }

          const getInfoOk = response.ok && response.isJson();
        api.get_info_ok = calculateValidationLevel(getInfoOk, chainId, "nodeApi_get_info_level");
        api.get_info_ms = response.elapsedTimeInMilliseconds;
        api.get_info_errortype = response.errorType;
        api.get_info_httpcode = response.httpCode;

        if (api.get_info_ok !== ValidationLevel.SUCCESS) {
          failedRequestCounter++;
          return;
        }

        /**
         * Test 1.1: Server Version
         */
        if (getChainsConfigItem(chainId, "nodeApi_server_version")) {
          const serverVersion = response.getDataItem(["server_version_string"])
            ? response.getDataItem(["server_version_string"])
            : "";
          // todo: test code
          const serverVersionOk =
            serverVersionsConfig[chainId][serverVersion] !== undefined &&
            serverVersionsConfig[chainId][serverVersion]["valid"];
          api.server_version_ok = calculateValidationLevel(serverVersionOk, chainId, "nodeApi_server_version_level");
          api.server_version = serverVersion === "" ? null : serverVersion;
        }

        /**
         * Test 1.2: NodeApi for correct chain
         */
        if (getChainsConfigItem(chainId, "nodeApi_correct_chain")) {
          const correctChain: boolean =
            typeof response.getDataItem(["chain_id"]) === "string" && response.getDataItem(["chain_id"]) === chainId;
          api.correct_chain = calculateValidationLevel(correctChain, chainId, "nodeApi_correct_chain_level");
        }

        /**
         * Test 1.3: Head Block up to date
         */
        if (getChainsConfigItem(chainId, "nodeApi_head_block_delta")) {
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
            const headBlockDeltaOk = Math.abs(timeDelta) < config.get("validation.api_head_block_time_delta");
            api.head_block_delta_ok = calculateValidationLevel(
              headBlockDeltaOk,
              chainId,
              "nodeApi_head_block_delta_level"
            );
            api.head_block_delta_ms = timeDelta;

          } else {
            api.head_block_delta_ok = calculateValidationLevel(false, chainId, "nodeApi_head_block_delta_level");
          }
        }
      });
  }
  /**
   * Test 2: Block one exists
   */
  if (getChainsConfigItem(chainId, "nodeApi_block_one")) {
    await http
      .request(endpointUrl, "nodeApi_block_one", chainId, failedRequestCounter)
      .then((response) => {
        const blockOneOk = response.ok && response.isJson();
        api.block_one_ok = calculateValidationLevel(blockOneOk, chainId, "nodeApi_block_one_level");
        api.block_one_ms = response.elapsedTimeInMilliseconds;
        api.block_one_errortype = response.errorType;
        api.block_one_httpcode = response.httpCode;

        if (api.block_one_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
      });
  }

  /**
   * Test 3: Verbose Error
   */
  if (getChainsConfigItem(chainId, "nodeApi_verbose_error")) {
    await http.request(endpointUrl, "nodeApi_verbose_error", chainId, 999).then((response) => {
      api.verbose_error_ms = response.elapsedTimeInMilliseconds;
      // todo: ensure no check on undefined
      const verboseErrorOk =
        !response.ok && response.isJson() && response.getDataItem(["error", "details"]) && Object.keys(response.getDataItem(["error", "details"])).length != 0;
      api.verbose_error_ok = calculateValidationLevel(verboseErrorOk, chainId, "nodeApi_verbose_error_level");
      api.verbose_error_errortype = response.errorType;
      api.verbose_error_httpcode = response.httpCode;

      if (api.verbose_error_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
    });
  }

  /**
   * Test 4: abi serializer
   */
  if (getChainsConfigItem(chainId, "nodeApi_abi_serializer")) {
    let expectedBlockCount = -1;
    try {
      expectedBlockCount = Number.parseInt(getChainsConfigItem(chainId, "$nodeApi_expected_block_count"));
    } catch (e) {
      logger.fatal(
        "Error during parsing $nodeApi_expected_block_count from config/chains.csv. This will result in wrong validation results."
      );
    }
    await http
      .request(endpointUrl, "nodeApi_abi_serializer", chainId, failedRequestCounter)
      .then((response) => {
        api.abi_serializer_ms = response.elapsedTimeInMilliseconds;
        const abiSerializerOk =
          response.ok &&
          response.getDataItem(["transactions"]) &&
          Object.keys(response.getDataItem(["transactions"])).length === expectedBlockCount;
        api.abi_serializer_ok = calculateValidationLevel(abiSerializerOk, chainId, "nodeApi_abi_serializer_level");
        api.abi_serializer_errortype = response.errorType;
        api.abi_serializer_httpcode = response.httpCode;

        if (api.abi_serializer_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
      });
  }

  /**
   * Test 5: basic symbol
   */
  if (getChainsConfigItem(chainId, "nodeApi_basic_symbol")) {
    await http
      .request(endpointUrl, "nodeApi_basic_symbol", chainId, failedRequestCounter)
      .then((response) => {
        const basicSymbolOk = response.ok && Array.isArray(response.dataJson) && response.dataJson.length == 1;
        api.basic_symbol_ok = calculateValidationLevel(basicSymbolOk, chainId, "nodeApi_basic_symbol_level");
        api.basic_symbol_ms = response.elapsedTimeInMilliseconds;
        api.basic_symbol_errortype = response.errorType;
        api.basic_symbol_httpcode = response.httpCode;

        if (api.basic_symbol_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
      });
  }

  /**
   * Test 6: producer api disabled
   */
  if (getChainsConfigItem(chainId, "nodeApi_producer_api")) {
    await http.request(endpointUrl, "nodeApi_producer_api", chainId, 999).then((response) => {
      // Set status in database
      api.producer_api_ms = response.elapsedTimeInMilliseconds;
      // Test should be successful if a html page is returned, hence !response.isJson()
      const producerApiOff =
        (!response.ok && response.errorType === HttpErrorType.HTTP && response.httpCode > 100) || !response.isJson();
      api.producer_api_off = calculateValidationLevel(producerApiOff, chainId, "nodeApi_producer_api_level");

      api.producer_api_errortype = response.errorType;
      api.producer_api_httpcode = response.httpCode;

      if (api.producer_api_off !== ValidationLevel.SUCCESS) failedRequestCounter++;
    });
  }

  /**
   * Test 7: db_size api disabled
   */
  if (getChainsConfigItem(chainId, "nodeApi_db_size_api")) {
    await http.request(endpointUrl, "nodeApi_db_size_api", chainId, 999).then((response) => {
      // Set status in database
      api.db_size_api_ms = response.elapsedTimeInMilliseconds;
      // Test should be successful if a html page is returned, hence !response.isJson()
      const dbSizeApiOff =
        (!response.ok && response.errorType === HttpErrorType.HTTP && response.httpCode > 100) || !response.isJson();
      api.db_size_api_off = calculateValidationLevel(dbSizeApiOff, chainId, "nodeApi_db_size_api_level");

      api.db_size_api_errortype = response.errorType;
      api.db_size_api_httpcode = response.httpCode;

      if (api.db_size_api_off !== ValidationLevel.SUCCESS) failedRequestCounter++;
    });
  }

  /**
   * Test 8: net api disabled
   */
  if (getChainsConfigItem(chainId, "nodeApi_net_api")) {
    await http.request(endpointUrl, "nodeApi_net_api", chainId, 999).then((response) => {
      // Set status in database
      api.net_api_ms = response.elapsedTimeInMilliseconds;
      // Test should be successful if a html page is returned, hence !response.isJson()
      const netApiOff =
        (!response.ok && response.errorType === HttpErrorType.HTTP && response.httpCode > 100) || !response.isJson();
      api.net_api_off = calculateValidationLevel(netApiOff, chainId, "nodeApi_net_api_level");

      api.net_api_errortype = response.errorType;
      api.net_api_httpcode = response.httpCode;

      if (api.net_api_off !== ValidationLevel.SUCCESS) failedRequestCounter++;
    });
  }

  /**
   * Set all checks ok
   */
  const validations: [string, ValidationLevel][] = [
    ["nodeApi_location", api.location_ok],
    ["nodeApi_endpoint_url_ok", api.endpoint_url_ok],
    ["nodeApi_get_info", api.get_info_ok],
    ["nodeApi_server_version", api.server_version_ok],
    ["nodeApi_correct_chain", api.correct_chain],
    ["nodeApi_head_block_delta", api.head_block_delta_ok],
    ["nodeApi_block_one", api.block_one_ok],
    ["nodeApi_verbose_error", api.verbose_error_ok],
    ["nodeApi_abi_serializer", api.abi_serializer_ok],
    ["nodeApi_basic_symbol", api.basic_symbol_ok],
    ["nodeApi_producer_api", api.producer_api_off],
    ["nodeApi_db_size_api", api.db_size_api_off],
    ["nodeApi_net_api", api.net_api_off],
  ];
  if (isSSL) validations.push(["nodeApi_ssl", api.ssl_ok]);

  api.all_checks_ok = allChecksOK(validations, chainId);

  /**
   * Store results in Database
   */
  try {
    await database.manager.save(api);
    childLogger.debug(
      "SAVED \t New NodeApi validation to database for " +
        guild.name +
        " " +
        getChainsConfigItem(chainId, "name") +
        " to database"
    );
  } catch (error) {
    childLogger.fatal("Error while saving new NodeApi validation to database", error);
  }

  return api;
}
