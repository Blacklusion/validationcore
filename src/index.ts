import * as config from "config";
import { chainsConfig, getChainsConfigItem, logger, readConfig } from "./validationcore-database-scheme/common";
import { createConnections } from "typeorm";
import { validateAllChains } from "./validation/validate-chain";

/**
 * STARTUP:
 *  - Connection to database
 *  - Initialization of interval based validation
 */
function main() {
  console.log(
    " _    __      ___     __      __  _                                          ___ \n" +
      "| |  / /___ _/ (_)___/ /___ _/ /_(_)___  ____  _________  ________     _   _|__ \\\n" +
      "| | / / __ `/ / / __  / __ `/ __/ / __ \\/ __ \\/ ___/ __ \\/ ___/ _ \\   | | / /_/ /\n" +
      "| |/ / /_/ / / / /_/ / /_/ / /_/ / /_/ / / / / /__/ /_/ / /  /  __/   | |/ / __/ \n" +
      "|___/\\__,_/_/_/\\__,_/\\__,_/\\__/_/\\____/_/ /_/\\___/\\____/_/   \\___/    |___/____/"
  );
  console.log("    by Blacklusion - 2021\n\n");

  logger.info("Starting up " + config.get("general.name") + "...");

  // Read Config and abort if config is not set correctly
  logger.info("Reading Config...");

  if (!readConfig()) {
    logger.fatal("Aborting Startup...");
    return;
  }

  // Create a separate connection for every chain
  const connections = [];
  for (const chainId in chainsConfig) {
    // todo: check await
    if (typeof chainId === "string") {
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
      validateAllChains();
      setInterval(validateAllChains, config.get("validation.validation_round_interval"));
    })
    .catch((error) => {
      logger.error("Error while connecting to database ", error);
    });
}

main();
