import {
  calculateValidationLevel,
  logger,
  allChecksOK, validateBpLocation, extractLongitude, extractLatitude
} from "../validationcore-database-scheme/common";
import { Guild } from "../validationcore-database-scheme/entity/Guild";
import { getConnection } from "typeorm";
import { Logger } from "tslog";
import * as http from "../httpConnection/HttpRequest";
import { isURL } from "validator";
import { NodeWallet } from "../validationcore-database-scheme/entity/NodeWallet";
import { ValidationLevel } from "../validationcore-database-scheme/enum/ValidationLevel";
import * as config from "config";
import { getChainsConfigItem } from "../validationcore-database-scheme/readConfig";


/**
 * Logger Settings for NodeApi
 */
const childLogger: Logger = logger.getChildLogger({
  name: "WALLET-Validation",
  displayFilePath: "hidden",
  displayLoggerName: true,
});

/**
 * Performs all validations for an NodeWallet-Node
 * @param {Guild} guild = guild for which the NodeWallet is validated (must be tracked in database)
 * @param {string} chainId = chainId of chain that is validated
 * @param {string} endpointUrl = url of the api node (http and https possible)
 * @param {boolean} isSSL = if true, it is also validated if TLS is working. Then the NodeWallet will only be considered healthy, if all checks pass and if TLS is working
 * @param {unknown} location = location information as in bp.json
 */
export async function validateWallet(
  guild: Guild,
  chainId: string,
  endpointUrl: string,
  isSSL: boolean,
  location: unknown
): Promise<NodeWallet> {
  if (!endpointUrl) return undefined;

  // Counts how many requests have failed. If performance mode is enabled, future requests may not be performed, if to many requests already failed
  let failedRequestCounter = 0;

  // Create wallet object for database
  const database = getConnection(chainId);
  const wallet: NodeWallet = new NodeWallet();
  wallet.instance_id = config.get("general.instance_id")
  wallet.guild = guild.name;
  wallet.endpoint_url = endpointUrl;
  wallet.is_ssl = isSSL;


  if (getChainsConfigItem(chainId, "nodeWallet_location")) {
    wallet.location_ok = calculateValidationLevel(validateBpLocation(location), chainId, "nodeWallet_location_level");
    wallet.location_longitude = extractLongitude(location);
    wallet.location_latitude = extractLatitude(location);
  }

  // Check if valid EndpointUrl has been provided
  if (getChainsConfigItem(chainId, "nodeWallet_endpoint_url_ok")) {
    const endpointUrlOk = isURL(endpointUrl, {
      require_protocol: true,
    });

    wallet.endpoint_url_ok = calculateValidationLevel(endpointUrlOk, chainId, "nodeWallet_endpoint_url_ok_level");
  }


  /**
   * Test 1: Wallet - get_accounts_by_authorizers
   */
  if (getChainsConfigItem(chainId, "nodeWallet_accounts")) {
    await http
      .request(endpointUrl, "nodeWallet_accounts", chainId, failedRequestCounter)
      .then((response) => {

        /**
         * SSL Check
         */
        if (isSSL && getChainsConfigItem(chainId, "nodeWallet_ssl")) {
          http.evaluateSSL(endpointUrl, response.ok, response.errorType).then((response) => {
            wallet.ssl_ok = calculateValidationLevel(response.ok, chainId, "nodeWallet_ssl_level");
            wallet.ssl_errortype = response.errorType;
            if (wallet.ssl_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
          });
        }

        const accountsOk = response.ok && response.isJson();
        wallet.accounts_ok = calculateValidationLevel(accountsOk, chainId, "nodeWallet_accounts_level");
        wallet.accounts_ms = response.elapsedTimeInMilliseconds;
        wallet.accounts_errortype = response.errorType;
        wallet.accounts_httpcode = response.httpCode;

        if (wallet.accounts_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
      });
  }

  /**
   * Test 2: Wallet - get_accounts_by_authorizers
   */
  if (getChainsConfigItem(chainId, "nodeWallet_keys")) {
    await http
      .request(endpointUrl, "nodeWallet_keys", chainId, failedRequestCounter)
      .then((response) => {
        const keysOk = response.ok && response.isJson();
        wallet.keys_ok = calculateValidationLevel(keysOk, chainId, "nodeWallet_keys_level");
        wallet.keys_ms = response.elapsedTimeInMilliseconds;
        wallet.keys_errortype = response.errorType;
        wallet.keys_httpcode = response.httpCode;

        if (wallet.keys_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
      });
  }

  const validations: [string, ValidationLevel][] = [
    ["nodeWallet_location", wallet.location_ok],
    ["nodeWallet_endpoint_url_ok", wallet.endpoint_url_ok],
    ["nodeWallet_accounts", wallet.accounts_ok],
    ["nodeWallet_keys", wallet.keys_ok],
  ];

  if (isSSL) validations.push(["nodeWallet_ssl", wallet.ssl_ok]);

  wallet.all_checks_ok = allChecksOK(validations, chainId);

  /**
   * Store results in Database
   */
  try {
    await database.manager.save(wallet);
    childLogger.debug(
      "SAVED \t New NodeWallet validation to database for " +
        guild.name +
        " " +
        getChainsConfigItem(chainId, "name") +
        " to database"
    );
  } catch (error) {
    childLogger.fatal("Error while saving new NodeWallet validation to database", error);
  }

  return wallet;
}
