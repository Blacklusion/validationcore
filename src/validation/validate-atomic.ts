import * as config from "config";
import { Logger } from "tslog";
import { logger } from "../common";
import { Guild } from "../database/entity/Guild";
import { Atomic } from "../database/entity/Atomic";
import { getConnection } from "typeorm";
import * as http from "../httpConnection/HttpRequest";
import { HttpErrorType } from "../httpConnection/HttpErrorType";

/**
 * Logger Settings for Atomic
 */
const childLogger: Logger = logger.getChildLogger({
  name: "Atomic-Validation",
  displayFilePath: "hidden",
  displayLoggerName: true,
});

/**
 * Performs all validations for an Atomic-Api
 * @param {Guild} guild = guild for which the Atomic-Api is validated (must be tracked in database)
 * @param {Boolean} isMainnet = only either testnet or mainnet is validated. If set to true, Mainnet will be validated
 * @param {string} apiEndpoint = url of the api node (http and https possible)
 * @param {boolean} isSsl = if true, it is also validated if TLS is working. Then the Api will only be considered healthy, if all checks pass and if TLS is working
 * @param {boolean} locationOk = states if the location information found in the bp.json is valid
 * @param {string[]} features = Array of features supplied in the bp.json, describing which features the Api should support
 */
export async function validateAll(
  guild: Guild,
  isMainnet: boolean,
  apiEndpoint: string,
  isSsl: boolean
): Promise<Atomic> {
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
  const atomic: Atomic = new Atomic();
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
   * Test 1
   */
  await http
    .get(
      apiEndpoint,
      "/health",
      http.evaluatePerformanceMode(failedRequestCounter)
    )
    .then((response) => {
      if (!response.ok || (response.ok && !response.isJson())) {
        return;
      }

      let errorCounterLocal = 0;

      if (response.getDataItem(["success"]) !== true)
        errorCounterLocal++;

      if ()





    });

  /**
   * Store results in Database
   */
  try {
    await database.manager.save(atomic);
    childLogger.debug(
      "SAVED \t New Atomic validation to database for " +
      guild.name +
      " " +
      (isMainnet ? "mainnet" : "testnet") +
      " to database"
    );
  } catch (error) {
    childLogger.fatal("Error while saving new Atomic validation to database", error);
  }

  return atomic;
}