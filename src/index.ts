import * as config from "config";
import * as HttpRequest from "./httpConnection/HttpRequest";
import { validateAll } from "./validation/validate-organization";
import { Guild } from "./database/entity/Guild";
import { logger } from "./common";
import { Organization } from "./database/entity/Organization";
import { createConnection, getConnection } from "typeorm";
const fetch = require("node-fetch");
import { JsonRpc } from "eosjs";
import { error, log } from "util";
import { sendMessageApi } from "./telegramHandler";

async function validateGuild(guildName: string) {
  const database = getConnection();
  const guild = await database.manager.findOne(Guild, {
    where: [{ name: guildName }],
  });
  if (!guild) {
    logger.error('Requested Guild "' + guildName + '" is not tracked in the Database. Aborting Validation...');
    return;
  }

  /**
   * Validate Guild for Mainnet
   */
  if (guild.isMainnet) {
    await validateAll(guild, true);
  }

  /**
   * Validate Guild for Testnet
   */
  if (guild.isTestnet) {
    await validateAll(guild, false);
  }
}

async function updateGuildTable(isMainnet: boolean) {
  const database = getConnection();
  const rpc = new JsonRpc(isMainnet ? config.get("mainnet.api_endpoint") : config.get("testnet.api_endpoint"), {
    fetch,
  });

  try {
    let results = await rpc.get_producers(true, "", config.get("validation.producer_limit"));
    results = { ...results.rows };

    let counter = 0;
    for (const i in results) {
      const producer = results[i];

      if (producer && producer.is_active == 1 && producer.url && producer.url) {
        counter++;
        const guild = new Guild();
        guild.name = producer.owner;

        const guildFromDatabase = await database.manager.findOne(Guild, guild.name);

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
    console.log(counter);
  } catch (error) {
    logger.fatal("Error while updating guildTable", error);
  }
}

function main() {
  logger.info("Starting up " + config.get("general.name") + "...");

  if (!(config.has("general.pager_mode") ? config.get("general.pager_mode") : false))
    logger.info("Pager mode is disabled. No pager messages will be sent.");

  createConnection()
    .then(async (database) => {
      // todo: add database name here
      logger.info("Successfully connected to database ");

      const guildName = "blacklusionx";
      // await validateGuild(guildName)
      await validateAllGuilds();

      setInterval(validateAllGuilds, 600000);
    })
    .catch((error) => {
      logger.error("Error while connecting to database ", error);
    });
}

async function validateAllGuilds() {
  const database = getConnection();

  console.log("\n\n\n");
  logger.info("STARTING NEW VALIDATION");

  /**
   * Update Guildinformation in guildtable
   */
  await updateGuildTable(true);
  await updateGuildTable(false);

  /**
   * Validate every guild in guildTable
   */
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
        validateAll(guild, true);
      }

      /**
       * Validate Guild for Testnet
       */
      if (guild.isTestnet) {
        validateAll(guild, false);
      }
    });
  });
}

async function addGuild() {
  const database = getConnection();
  const guild: Guild = new Guild();
  guild.name = "blacklusionx";
  guild.isTestnet = true;
  guild.isMainnet = true;
  // guild.mainnet_location = "267";
  // guild.testnet_location = "267";
  guild.mainnet_url = "https://blacklusion.io";
  guild.testnet_url = "https://blacklusion.io";
  await database.manager.save(guild);
}

main();

function pingWebsite(url: string) {
  HttpRequest.get(url)
    .then((response) => {
      console.log("*** SUCCESS ***");
      console.log("*** TRUE *** Website is online");
    })
    .catch((error) => {
      console.log("*** ERROR ***");
      console.log(error);
    });
}

// pingWebsite(tesUrl);
