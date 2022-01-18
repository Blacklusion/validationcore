import * as config from "config";
import { createConnections } from "typeorm";
import { validateAllChains } from "./validation/validate-chain";
import { logger } from "./validationcore-database-scheme/common";
import { chainsConfig, getChainsConfigItem, readConfig } from "./validationcore-database-scheme/readConfig";
import PQueue from "p-queue";
import { sendStartSignalToSlaves, startSlaveServer } from "./masterSlaveConnection";

export let globalNodeSeedQueue: PQueue;
/**
 * STARTUP:
 *  - Connection to database
 *  - Initialization of interval based validation
 */
function main() {
  console.log(
    " _    __      ___     __      __  _                                          _____\n" +
    "| |  / /___ _/ (_)___/ /___ _/ /_(_)___  ____  _________  ________     _   _|__  /\n" +
    "| | / / __ `/ / / __  / __ `/ __/ / __ \\/ __ \\/ ___/ __ \\/ ___/ _ \\   | | / //_ < \n" +
    "| |/ / /_/ / / / /_/ / /_/ / /_/ / /_/ / / / / /__/ /_/ / /  /  __/   | |/ /__/ / \n" +
    "|___/\\__,_/_/_/\\__,_/\\__,_/\\__/_/\\____/_/ /_/\\___/\\____/_/   \\___/    |___/____/  \n" +
    "                                                                                  "
  );
  console.log("    by Blacklusion - 2021\n\n");

  logger.info("Starting up " + config.get("general.name") + "...");

  // Read Config and abort if config is not set correctly
  logger.info("Reading Config...");

  if (!readConfig()) {
    logger.fatal("Aborting Startup...");
    return;
  }

  // Initialize global SeedNode Queue. Used to limit concurrent validations of SeedNodes
  globalNodeSeedQueue = new PQueue({concurrency: config.get("validation.seed_concurrent_validations")})

  // Create a separate connection for every chain
  const connections = [];
  for (const chainId in chainsConfig) {
    if (chainId && typeof chainId === "string") {
      connections.push({
        name: chainId,
        type: "postgres",
        host: config.get("database.postgres_host"),
        port: config.get("database.postgres_port"),
        username: config.get("database.postgres_user"),
        password: config.get("database.postgres_password"),
        database: getChainsConfigItem(chainId, "name"),
        entities: [__dirname + "/validationcore-database-scheme/entity/*{.js,.ts}"],
        synchronize: true,
      });
    }
  }

  createConnections(connections)
    .then(async () => {
      logger.info("Successfully connected to databases");
      logger.info("++++++++  STARTUP COMPLETE  ++++++++");

      /**
       * Add Schemas to Database to prevent errors in functions querying the database
       */

      /**
       * Initialize interval based validations
       */
      if (config.get("general.is_master")) {
        logger.info("[ Mode ] = Master");
        validateAllChains();
        sendStartSignalToSlaves();
        setInterval(validateAllChains, config.get("validation.validation_round_interval"));
      } else {
        logger.info("[ Mode ] = Slave");
        startSlaveServer();
      }
    })
    .catch((error) => {
      logger.error("Error while connecting to database ", error);
    });
}

main();
