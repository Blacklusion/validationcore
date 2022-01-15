import * as config from "config";
import {
  allChecksOK,
  calculateValidationLevel, extractLatitude, extractLongitude,
  logger, validateBpLocation
} from "../validationcore-database-scheme/common";
import { Guild } from "../validationcore-database-scheme/entity/Guild";
import { getConnection } from "typeorm";
import { Logger } from "tslog";
import * as http from "../httpConnection/HttpRequest";
import { NodeAtomic } from "../validationcore-database-scheme/entity/NodeAtomic";
import { isURL } from "validator";
import { ValidationLevel } from "../validationcore-database-scheme/enum/ValidationLevel";
import { getChainsConfigItem } from "../validationcore-database-scheme/readConfig";

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
 * @param {string} chainId = chainId of chain that is validated
 * @param {string} endpointUrl = url of the api node (http and https possible)
 * @param {boolean} isSSL = if true, it is also validated if TLS is working. Then the NodeApi will only be considered healthy, if all checks pass and if TLS is working
 * @param {unknown} location = location information as in bp.json
 */
export async function validateAtomic(
  guild: Guild,
  chainId: string,
  endpointUrl: string,
  isSSL: boolean,
  location: unknown
): Promise<NodeAtomic> {
  if (!endpointUrl) return undefined;

  // Counts how many requests have failed. If performance mode is enabled, future requests may not be performed, if to many requests already failed
  let failedRequestCounter = 0;

  // Create atomic object for database
  const database = getConnection(chainId);
  const atomic: NodeAtomic = new NodeAtomic();
  atomic.instance_id = config.get("general.instance_id")
  atomic.guild = guild.name;
  atomic.endpoint_url = endpointUrl;
  atomic.is_ssl = isSSL;


  if (getChainsConfigItem(chainId, "nodeAtomic_location")) {
    atomic.location_ok = calculateValidationLevel(validateBpLocation(location), chainId, "nodeAtomic_location_level");
    atomic.location_longitude = extractLongitude(location);
    atomic.location_latitude = extractLatitude(location);
  }

  // Check if valid EndpointUrl has been provided
  if (getChainsConfigItem(chainId, "nodeAtomic_endpoint_url_ok")) {
    const endpointUrlOk = isURL(endpointUrl, {
      require_protocol: true,
    });
    atomic.endpoint_url_ok = calculateValidationLevel(endpointUrlOk, chainId, "nodeAtomic_endpoint_url_ok_level");
  }


  /**
   * Test 1 Health Checks
   */
  if (getChainsConfigItem(chainId, "nodeAtomic_health")) {
    await http
      .request(endpointUrl, "nodeAtomic_health", chainId, failedRequestCounter)
      .then((response) => {

        /**
         * SSL Check
         */
        if (isSSL && getChainsConfigItem(chainId, "nodeAtomic_ssl")) {
          http.evaluateSSL(endpointUrl, response.ok, response.errorType).then((response) => {
            atomic.ssl_ok = calculateValidationLevel(response.ok, chainId, "nodeAtomic_ssl_level");
            atomic.ssl_errortype = response.errorType;
            if (atomic.ssl_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
          });
        }

        const healthFound = response.ok && response.isJson();
        atomic.health_ms = response.elapsedTimeInMilliseconds;
        atomic.health_found = calculateValidationLevel(healthFound, chainId, "nodeAtomic_health_level");
        atomic.health_errortype = response.errorType;
        atomic.health_httpcode = response.httpCode;

        if (atomic.health_found !== ValidationLevel.SUCCESS) {
          failedRequestCounter++;
          return;
        }

        /**
         * Test 1.1 Access Control Allow Header Checks
         */
        if (getChainsConfigItem(chainId, "nodeAtomic_health_access_control_header")) {
          const atomicAccessControlHeaderOk =
            response.headers !== undefined &&
            response.headers.has("access-control-allow-headers");

          atomic.health_access_control_header_ok = calculateValidationLevel(
            atomicAccessControlHeaderOk,
            chainId,
            "nodeAtomic_health_access_control_header_level"
          );
        }

        // Test 1.2 Health version
      atomic.server_version = response.getDataItem(["data", "version"]);

        /**
         * Test 1.3 Status of Services
         */
        // Status of Postgres Service
        if (getChainsConfigItem(chainId, "nodeAtomic_health_postgres")) {
          const healthPostgresOk = response.getDataItem(["data", "postgres", "status"]) === "OK";
          atomic.health_postgres_ok = calculateValidationLevel(
            healthPostgresOk,
            chainId,
            "nodeAtomic_health_postgres_level"
          );
        }

        // Status of Redis Service
        if (getChainsConfigItem(chainId, "nodeAtomic_health_redis")) {
          const healthRedisOk = response.getDataItem(["data", "redis", "status"]) === "OK";
          atomic.health_redis_ok = calculateValidationLevel(healthRedisOk, chainId, "nodeAtomic_health_redis_level");
        }

        // Status of Chain Service
        if (getChainsConfigItem(chainId, "nodeAtomic_health_chain")) {
          const healthChainOk = response.getDataItem(["data", "chain", "status"]) === "OK";
          atomic.health_chain_ok = calculateValidationLevel(healthChainOk, chainId, "nodeAtomic_health_chain_level");
        }

        /**
         * Test 1.4 Check head block of reader
         */
        if (getChainsConfigItem(chainId, "nodeAtomic_health_total_indexed_blocks")) {
          const missingBlocks =
            response.getDataItem(["data", "chain", "head_block"]) -
            Number.parseInt(response.getDataItem(["data", "postgres", "readers", "0", "block_num"]));
          const totalIndexedBlocksOk = missingBlocks <= config.get("validation.atomic_tolerated_missing_blocks");
          atomic.health_total_indexed_blocks_ok = calculateValidationLevel(
            totalIndexedBlocksOk,
            chainId,
            "nodeAtomic_health_total_indexed_blocks_level"
          );
          atomic.health_missing_blocks = missingBlocks;
        }
      });
  }

  /**
   * Test 2 Get Asset by ID
   */
  if (getChainsConfigItem(chainId, "nodeAtomic_assets")) {
    await http
      .request(endpointUrl, "nodeAtomic_assets", chainId, failedRequestCounter)
      .then((response) => {
        atomic.assets_ok = calculateValidationLevel(response.ok, chainId, "nodeAtomic_assets_level");
        atomic.assets_ms = response.elapsedTimeInMilliseconds;
        atomic.assets_errortype = response.errorType;
        atomic.assets_httpcode = response.httpCode;

        if (atomic.assets_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
      });
  }

  /**
   * Test 3 Get Collection by name
   */
  if (getChainsConfigItem(chainId, "nodeAtomic_collections")) {
    await http
      .request(endpointUrl, "nodeAtomic_collections", chainId, failedRequestCounter)
      .then((response) => {
        atomic.collections_ok = calculateValidationLevel(response.ok, chainId, "nodeAtomic_collections_level");
        atomic.collections_ms = response.elapsedTimeInMilliseconds;
        atomic.collections_errortype = response.errorType;
        atomic.collections_httpcode = response.httpCode;

        if (atomic.collections_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
      });
  }

  /**
   * Test 4 Get Schema by name
   */
  if (getChainsConfigItem(chainId, "nodeAtomic_schemas")) {
    await http
      .request(endpointUrl, "nodeAtomic_schemas", chainId, failedRequestCounter)
      .then((response) => {
        atomic.schemas_ok = calculateValidationLevel(response.ok, chainId, "nodeAtomic_schemas_level");
        atomic.schemas_ms = response.elapsedTimeInMilliseconds;
        atomic.schemas_errortype = response.errorType;
        atomic.schemas_httpcode = response.httpCode;

        if (atomic.schemas_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
      });
  }

  /**
   * Test 5 Get Template by name
   */
  if (getChainsConfigItem(chainId, "nodeAtomic_templates")) {
    await http
      .request(endpointUrl, "nodeAtomic_templates", chainId, failedRequestCounter)
      .then((response) => {
        atomic.templates_ok = calculateValidationLevel(response.ok, chainId, "nodeAtomic_templates_level");
        atomic.templates_ms = response.elapsedTimeInMilliseconds;
        atomic.templates_errortype = response.errorType;
        atomic.templates_httpcode = response.httpCode;

        if (atomic.templates_ok !== ValidationLevel.SUCCESS) failedRequestCounter++;
      });
  }

  /**
   * Set all checks ok
   */
  const validations: [string, ValidationLevel][] = [
    ["nodeAtomic_location", atomic.location_ok],
    ["nodeAtomic_endpoint_url_ok", atomic.endpoint_url_ok],
    ["nodeAtomic_health", atomic.health_found],
    ["nodeAtomic_health_access_control_header", atomic.health_access_control_header_ok],
    ["nodeAtomic_health_postgres", atomic.health_postgres_ok],
    ["nodeAtomic_health_redis", atomic.health_redis_ok],
    ["nodeAtomic_health_chain", atomic.health_chain_ok],
    ["nodeAtomic_health_total_indexed_blocks", atomic.health_total_indexed_blocks_ok],
    ["nodeAtomic_assets", atomic.assets_ok],
    ["nodeAtomic_collections", atomic.collections_ok],
    ["nodeAtomic_schemas", atomic.schemas_ok],
    ["nodeAtomic_templates", atomic.templates_ok],
  ];

  if (isSSL) validations.push(["nodeAtomic_ssl", atomic.ssl_ok]);

  atomic.all_checks_ok = allChecksOK(validations, chainId);
  /**
   * Store results in Database
   */
  try {
    await database.manager.save(atomic);
    childLogger.debug(
      "SAVED \t New NodeAtomic validation to database for " +
        guild.name +
        " " +
        getChainsConfigItem(chainId, "name") +
        " to database"
    );
  } catch (error) {
    childLogger.fatal("Error while saving new NodeAtomic validation to database", error);
  }

  return atomic;
}
