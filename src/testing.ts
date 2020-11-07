import { getConnection } from "typeorm";
import { Guild } from "./database/entity/Guild";
import { logger } from "./common";
import { validateAll } from "./validation/validate-organization";

/**
 * Method used for TESTING purposes
 * Adds a single guild to database
 */
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

/**
 * Method used for TESTING purposes
 * Validates a single guild
 * @param guildName = Name of guild on chain
 */
async function validateGuild(guildName: string) {
  const database = getConnection();
  const guild = await database.manager.findOne(Guild, {
    where: [{ name: guildName }],
  });
  if (!guild) {
    logger.error('Requested Guild "' + guildName + '" is not tracked in the Database. Aborting Validation...');
    return;
  }

  // Validate Guild for Mainnet
  if (guild.isMainnet) {
    await validateAll(guild, true);
  }

  // Validate Guild for Testnet
  if (guild.isTestnet) {
    await validateAll(guild, false);
  }
}
