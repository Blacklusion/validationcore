import * as config from "config";
import { validateAll } from "./validation/validate-organization";
import { Guild } from "./database/entity/Guild";
import { logger } from "./common";
import { createConnection, getConnection } from "typeorm";
const fetch = require("node-fetch");
import { JsonRpc } from "eosjs";

// Increases before every validation round and is only used for better logging outputs
// Useful if validation rounds take longer than validation interval
let validationRoundCounter = 0;

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
  console.log("    by Blacklusion - 2020\n\n");

  logger.info("Starting up " + config.get("general.name") + "...");

  // Check if config file with all necessary settings exists
  if (!checkConfig()) {
    logger.fatal("Not all settings were set. Aborting startup...");
    return;
  } else {
    logger.info("Valid config/local.toml was found!");
  }

  // Check if Pager mode is enabled
  if (!(config.has("general.pager_mode") ? config.get("general.pager_mode") : false))
    logger.info("Pager mode is disabled. No pager messages will be sent.");

  createConnection()
    .then(async () => {
      logger.info("Successfully connected to database ");

      logger.info("++++++++  STARTUP COMPLETE  ++++++++\n\n");

      /**
       * Initialize interval based validations
       */
      await validateAllGuilds();
      setInterval(validateAllGuilds, 600000);
    })
    .catch((error) => {
      logger.error("Error while connecting to database ", error);
    });
}
main();

/**
 * Validates all guilds tracked by the database
 * The guild tables are updated before validating
 */
async function validateAllGuilds() {
  const database = getConnection();

  // Increase validationRoundCounter and safe local copy to prevent side effects
  const validationRoundCounterLocal = ++validationRoundCounter;

  console.log("\n\n\n");
  logger.info("STARTING NEW VALIDATION - " + validationRoundCounterLocal);

  /**
   * Update Guildinformation in guildtable
   */
  await updateGuildTable(true);
  await updateGuildTable(false);

  /**
   * Validate every guild in guildTable
   */
  const validationPromises: Promise<boolean>[] = [];
  await database.manager.find(Guild).then((guilds) => {
    guilds.forEach((guild) => {
      if (!guild) {
        logger.error('Requested Guild "' + "guildName" + '" is not tracked in the Database. Aborting Validation...');
        return;
      }

      /**
       * Validate Guild for Mainnet
       */
      if (guild.isMainnet) {
        validationPromises.push(validateAll(guild, true));
      }

      /**
       * Validate Guild for Testnet
       */
      if (guild.isTestnet) {
        validationPromises.push(validateAll(guild, false));
      }
    });
  });

  // Create Log output when all validations are finished
  Promise.all(validationPromises).then(() => {
    logger.info("VALIDATION ROUND COMPLETE! - " + validationRoundCounterLocal);
  });
}

/**
 * Gets all active producers from an Api and adds new guilds to the database
 * @param isMainnet = determines if guilds for Testnet or Mainnet are added
 */
async function updateGuildTable(isMainnet: boolean) {
  const database = getConnection();

  // Prepare Api Access
  const rpc = new JsonRpc(isMainnet ? config.get("mainnet.api_endpoint") : config.get("testnet.api_endpoint"), {
    fetch,
  });

  try {
    // Get producers from Api
    let results = await rpc.get_producers(true, "", config.get("validation.producer_limit"));
    results = { ...results.rows };

    // Update guild information one by one
    // todo: guard-for-in
    for (const i in results) {
      const producer = results[i];

      // Pursue only if guild is not a dummy guild
      if (producer && producer.is_active == 1 && producer.url && producer.owner) {
        const guild = new Guild();
        guild.name = producer.owner;

        // Get guild from database if it is already tracked
        const guildFromDatabase = await database.manager.findOne(Guild, guild.name);

        /**
         * Mainnet guild tables are updated
         */
        if (isMainnet) {
          guild.isMainnet = true;
          guild.mainnet_url = producer.url;
          guild.mainnet_location = producer.location;

          // Update existing guild in database
          if (guildFromDatabase) {
            logger.debug("Updated information for " + guild.name);
            await database.manager.update(Guild, guild.name, {
              isMainnet: guild.isMainnet,
              mainnet_location: guild.mainnet_location,
              mainnet_url: guild.mainnet_url,
            });
          }
          /**
           * Testnet guild tables are updated
           */
        } else {
          guild.isTestnet = true;
          guild.testnet_url = producer.url;
          guild.testnet_location = producer.location;

          // Update existing guild in database
          if (guildFromDatabase) {
            logger.debug("Updated information for " + guild.name);
            await database.manager.update(Guild, guild.name, {
              isTestnet: guild.isTestnet,
              testnet_location: guild.testnet_location,
              testnet_url: guild.testnet_url,
            });
          }
        }

        // Store in database if guild does not exist yet
        if (!guildFromDatabase) {
          logger.info("Added " + guild.name + " to database. This guild will now be monitored.");
          await database.manager.save(guild);
        }
      }
    }
  } catch (error) {
    logger.fatal("Error while updating guildTable", error);
  }
}

/**
 * Checks if all necessary settings are provided in config/local.toml
 * @return {boolean} = if true all settings are set correctly. Otherwise false is returned
 */
function checkConfig(): boolean {
  let allVariablesSet = true;

  const settings = [
    ["general.name", "string"],
    ["general.pager_mode", "boolean"],
    // Logging_level must not be provided -> defaults to info

    ["telegram.public_url", "string"],
    ["telegram.private_url", "string"],

    ["mainnet.name", "string"],
    ["mainnet.chain_id", "string"],
    ["mainnet.api_endpoint", "string"],
    ["mainnet.server_versions", "array"],
    ["mainnet.history_test_transaction", "string"],
    ["mainnet.history_test_public_key", "string"],
    ["mainnet.api_test_big_block", "number"],
    ["mainnet.api_test_big_block_transaction_count", "number"],
    ["mainnet.api_currency_symbol", "string"],
    ["mainnet.api_test_account", "string"],

    ["testnet.name", "string"],
    ["testnet.chain_id", "string"],
    ["testnet.api_endpoint", "string"],
    ["testnet.server_versions", "array"],
    ["testnet.history_test_transaction", "string"],
    ["testnet.history_test_public_key", "string"],
    ["testnet.api_currency_symbol", "string"],
    ["testnet.api_test_account", "string"],

    ["validation.request_retry_count", "number"],
    ["validation.request_retry_pause_ms", "number"],
    ["validation.request_timeout_ms", "number"],
    ["validation.producer_limit", "number"],
    ["validation.p2p_block_count", "number"],
    ["validation.p2p_ok_speed", "number"],
    ["validation.api_head_block_time_delta", "number"],
    ["validation.history_transaction_offset", "number"],
    ["validation.history_actions_block_time_delta", "number"],
    ["validation.hyperion_query_time_ms", "number"],
    ["validation.social_services", "array"],
  ];

  settings.forEach((setting) => {
    try {
      if (
        (setting[1] === "array" && !Array.isArray(config.get(setting[0]))) ||
        (setting[1] !== "array" && !(typeof config.get(setting[0]) === setting[1]))
      ) {
        logger.error(setting[0] + " was provided. But it is not of type " + setting[1]);
        allVariablesSet = false;
      }
    } catch (e) {
      logger.error(setting[0] + " was not provided!");
      allVariablesSet = false;
    }
  });

  return allVariablesSet;
}
