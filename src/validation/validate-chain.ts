import { getConnection } from "typeorm";
import { chainsConfig, getChainsConfigItem, logger } from "../validationcore-database-scheme/common";
import { Guild } from "../validationcore-database-scheme/entity/Guild";
import { validateGuild } from "./validate-guild";
import { JsonRpc } from "eosjs";
import { Logger } from "tslog";
import * as config from "config";
import * as fetch from "node-fetch";

// Increases before every validation round and is only used for better logging outputs
// Useful if validation rounds take longer than validation interval
let validationRoundCounter = 0;

/**
 * Validates all guilds tracked by the database
 * The guild tables are updated before validating
 */
export async function validateAllChains() {
  // Increase validationRoundCounter and safe local copy to prevent side effects
  const validationRoundCounterLocal = ++validationRoundCounter;

  console.log("\n\n");
  logger.info("STARTING NEW VALIDATION ROUND (" + validationRoundCounterLocal + ")");

  for (const chainId in chainsConfig) {
    // todo: check await
    if (typeof chainId === "string") await validateChain(chainId, validationRoundCounterLocal);
  }
}

/**
 * Validates all guilds of a single chain
 * @param {string} chainId = Of the chain that is supposed to be validated
 * @param {number} validationRoundCounterLocal = counter used for log outputs
 */
async function validateChain(chainId: string, validationRoundCounterLocal: number) {
  // todo: test code
  const childLogger: Logger = logger.getChildLogger({
    name: getChainsConfigItem(chainId, "name"),
    displayFilePath: "hidden",
    displayLoggerName: true,
  });

  const database = getConnection(chainId);

  // Update GuildTable
  await updateGuildTable(chainId);

  /**
   * Validate every guild in guildTable
   */
  const validationPromises: Promise<boolean>[] = [];
  let resolvedGuildCounter = 0;
  let guildsArray: string[] = [];
  await database.manager.find(Guild).then((guilds) => {
    guilds.forEach((guild) => {
      guildsArray.push(guild.name);
      const promise = validateGuild(guild, chainId);
      validationPromises.push(promise);
      promise.then(() => {
        guildsArray = guildsArray.filter((x) => x !== guild.name);
        resolvedGuildCounter++;
        childLogger.info(
          "ROUND " +
            validationRoundCounterLocal +
            " - [" +
            resolvedGuildCounter +
            "/" +
            guilds.length +
            "] Finished evaluating guild " +
            guild.name +
            (guildsArray.length <= 5 ? ", missing guilds: " + guildsArray : "")
        );
      });
    });
  });

  // Create Log output when all validations are finished
  await Promise.all(validationPromises)
    .then((x) => {
      childLogger.info("VALIDATION ROUND COMPLETE! (" + validationRoundCounterLocal + ")");
    })
    .catch((e) => {
      childLogger.error("ERROR DURING VALIDATION ROUND (" + validationRoundCounterLocal + ")", e);
    });

  return Promise.resolve(true);
}

/**
 * Gets all active producers from an NodeApi and adds new guilds to the database
 * @param {string} chainId = determines the chain for which the producers are updated
 */
async function updateGuildTable(chainId: string) {
  const database = getConnection(chainId);

  logger.info("Update GuildTable for " + getChainsConfigItem(chainId, "name"));

  // Prepare NodeApi Access
  const rpc = new JsonRpc(getChainsConfigItem(chainId, "api_endpoint"), {
    fetch,
  });

  try {
    // Get producers from NodeApi
    // todo: add producer_limit to chains.csv
    let results = await rpc.get_producers(true, "", config.get("validation.producer_limit"));
    results = { ...results.rows };

    // Update guild information one by one
    // todo: test code
    for (const i in results) {
      if (typeof i === "string") {
        const producer = results[i];

        // Pursue only if guild is not a dummy guild
        if (producer && producer.is_active == 1 && producer.url && producer.owner) {
          const guild = new Guild();
          guild.name = producer.owner;
          guild.url = producer.url;
          guild.location = producer.location;

          // Get guild from database if it is already tracked
          const guildFromDatabase = await database.manager.findOne(Guild, guild.name);

          // Update existing guild in database
          if (guildFromDatabase) {
            logger.debug("Updated information for " + guild.name);
            await database.manager.update(Guild, guild.name, {
              location: guild.location,
              url: guild.url,
            });
          }
          // Store in database if guild does not exist yet
          else {
            logger.info(
              "Added " +
                guild.name +
                "on " +
                getChainsConfigItem(chainId, "name") +
                " to database. This guild will now be monitored."
            );
            await database.manager.save(guild);
          }
        }
      }
    }
  } catch (error) {
    logger.fatal("Error while updating guildTable", error);
  }
}
