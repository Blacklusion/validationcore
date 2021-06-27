import * as config from "config";
import { HttpErrorType } from "../httpConnection/HttpErrorType";
import * as ValidateHistory from "./validate-history";
import * as ValidateAtomic from "./validate-atomic";
import { logger } from "../common";
import { Guild } from "../database/entity/Guild";
import { NodeApi } from "../database/entity/NodeApi";
import { getConnection } from "typeorm";
import { Logger } from "tslog";
import { sendMessageApi } from "../telegramHandler";
import * as http from "../httpConnection/HttpRequest";
import { NodeAtomic } from "../database/entity/NodeAtomic";

/**
 * Logger Settings for NodeAtomic NodeApi
 */
const childLogger: Logger = logger.getChildLogger({
  name: "AA-Validation",
  displayFilePath: "hidden",
  displayLoggerName: true,
});

/**
 * Performs all validations for an NodeAtomic NodeApi-Node
 * @param {Guild} guild = guild for which the NodeAtomic NodeApi is validated (must be tracked in database)
 * @param {Boolean} isMainnet = only either testnet or mainnet is validated. If set to true, Mainnet will be validated
 * @param {string} apiEndpoint = url of the api node (http and https possible)
 * @param {boolean} isSsl = if true, it is also validated if TLS is working. Then the NodeApi will only be considered healthy, if all checks pass and if TLS is working
 * @param {boolean} locationOk = states if the location information found in the bp.json is valid
 */
export async function validateAll(
  guild: Guild,
  isMainnet: boolean,
  apiEndpoint: string,
  isSsl: boolean,
  locationOk: boolean,
): Promise<NodeAtomic> {
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

  // Create atomic object for database
  const database = getConnection();
  const atomic: NodeAtomic = new NodeAtomic();
  atomic.guild = guild.name;
  atomic.location_ok = locationOk;
  atomic.api_endpoint = apiEndpoint;
  atomic.validation_is_mainnet = isMainnet;

  /**
   * SSL Check
   */
  atomic.is_ssl = isSsl;
  if (isSsl) {
    let sslMessage = "";
    if (!new RegExp("https://.+").test(apiEndpoint)) {
      atomic.ssl_ok = false;
      sslMessage = "not ok, no https url provided";
    } else {
      await http.get(apiEndpoint, "", 0).then((response) => {
        if (response.ok || (!response.ok && response.errorType === HttpErrorType.HTTP)) {
          atomic.ssl_ok = true;
        } else {
          atomic.ssl_ok = false;
          sslMessage = "not ok: " + response.getFormattedErrorMessage();
        }
      });
    }
    atomic.ssl_message = sslMessage;
    if (!atomic.ssl_ok) failedRequestCounter++;
  }

  /**
   * Test 1 Health Checks
   */
  await http.get(apiEndpoint, "/health", http.evaluatePerformanceMode(failedRequestCounter)).then((response) => {
    atomic.health_found = response.ok && response.isJson();
    atomic.health_found_message = response.getFormattedErrorMessage();

    if (!atomic.health_found) {
      failedRequestCounter++;
      return;
    }

    // Test 1.1 Health version
    /*
    In the current implementation there is no check for the version, since the atomic NodeApi is still very young
    atomic.health_version_ok = response.getDataItem(["version"]) !== undefined;
     */


    /**
     * Test 1.1 Status of Services
     */
    let healthServicesStatus = true;
    let healthServiceMessage = "";
    if (response.getDataItem(["data", "postgres", "status"]) !== "OK") {
      healthServicesStatus = false;
      healthServiceMessage += ", postgres not OK";
    } else {
      atomic.health_postgres_ok = true;
    }
    if (response.getDataItem(["data", "redis", "status"]) !== "OK") {
      healthServicesStatus = false;
      healthServiceMessage += ", redis not OK";
    } else {
      atomic.health_redis_ok = true;
    }
    if (response.getDataItem(["data", "chain", "status"]) !== "OK") {
      healthServicesStatus = false;
      healthServiceMessage += ", chain not OK";
    } else {
      atomic.health_chain_ok = true;
    }

    atomic.health_services_ok = healthServicesStatus;
    atomic.health_services_message = healthServiceMessage;


    /**
     * Test 1.1 Check headblock of reader
     */
    const missingBlocks =  response.getDataItem(["data", "chain", "head_block"]) - Number.parseInt(response.getDataItem(["data", "postgres", "readers", "0", "block_num"]))
    if (missingBlocks <= config.get("validation.hyperion_tolerated_missing_blocks")) {
      atomic.health_total_indexed_blocks_ok = true;
    }
    atomic.health_total_indexed_blocks_message = "api is " + missingBlocks + " blocks behind"
  });


  /**
   * Test 2 Alive Checks
   */
  await http.get(apiEndpoint, "/alive", 0).then((response) => {
    if (response.data === "success") {
      atomic.alive_ok = true;
    } else {
      atomic.alive_ok = false;
      atomic.alive_message = response.data;
    }
  });

  /**
   * Test 2 Get Asset by ID
   */
  await http.get(apiEndpoint, "/atomicassets/v1/assets/1099536207476", 0).then((response) => {
    atomic.assets_ok = response.ok;
    atomic.assets_ms = response.elapsedTimeInMilliseconds
    atomic.assets_message = response.getFormattedErrorMessage();
  });

  /**
   * Test 3 Get Collection by name
   */
  await http.get(apiEndpoint, "/atomicassets/v1/collections/kogsofficial", 0).then((response) => {
    atomic.collections_ok = response.ok;
    atomic.collections_ms = response.elapsedTimeInMilliseconds
    atomic.collections_message = response.getFormattedErrorMessage();
  });

  /**
   * Test 4 Get Schema by name
   */
  await http.get(apiEndpoint, "/atomicassets/v1/schemas/kogsofficial/2ndedition", 0).then((response) => {
    atomic.schemas_ok = response.ok;
    atomic.schemas_ms = response.elapsedTimeInMilliseconds
    atomic.schemas_message = response.getFormattedErrorMessage();
  });


  /**
   * Set all checks ok
   * (location check is excluded, because a wrong location does not interfere with the function of an NodeApi node
   */
  // An unpleasant solution, however simplifying this into a single line would cause sideeffects with undefined. This ensures the result will always be a boolean
  if (
    atomic.health_found &&
    atomic.health_services_ok &&
    atomic.health_total_indexed_blocks_ok &&
    atomic.alive_ok &&
    atomic.assets_ok &&
    atomic.collections_ok &&
    atomic.schemas_ok
  ) {
    atomic.all_checks_ok = true;
  } else {
    atomic.all_checks_ok = false;
  }


  /**
   * Store results in Database
   */
  try {
    await database.manager.save(atomic);
    childLogger.debug(
      "SAVED \t New NodeAtomic validation to database for " +
      guild.name +
      " " +
      (isMainnet ? "mainnet" : "testnet") +
      " to database"
    );
  } catch (error) {
    childLogger.fatal("Error while saving new NodeAtomic validation to database", error);
  }

  return atomic;
}
