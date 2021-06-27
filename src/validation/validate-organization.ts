import * as api from "./validate-api";
import * as seed from "./validate-seed";
import * as config from "config";
import { logger } from "../common";
import { Validation } from "../database/entity/Validation";
import "reflect-metadata";
import { getConnection } from "typeorm";
import { Guild } from "../database/entity/Guild";
import { Logger } from "tslog";
import { sendMessageOrganization } from "../telegramHandler";
import { evaluateMessage, writeJsonToDisk, convertArrayToJson } from "../messageHandler";
import { NodeApi } from "../database/entity/NodeApi";
import { NodeSeed } from "../database/entity/NodeSeed";
import * as http from "../httpConnection/HttpRequest";

/**
 * Logger Settings for Validation
 */
const childLogger: Logger = logger.getChildLogger({
  name: "Org-Validation",
});

/**
 * Validates regged producer information, chains.json and bp.json for specified guild
 * Only one chain (mainnet or testnet) will be evaluated
 * @param {Guild} guild = guild for which the organization is validated (must be tracked in database)
 * @param {Boolean} isMainnet = only either testnet or mainnet is validated. If set to true, Mainnet will be validated
 */
export async function validateAll(guild: Guild, isMainnet: boolean): Promise<boolean> {
  // Set general variables
  const url: string = isMainnet ? guild.mainnet_url : guild.testnet_url;
  const chainId: string = isMainnet ? config.get("mainnet.chain_id") : config.get("testnet.chain_id");
  let pathToBpJson: string;

  // Create organization object for database
  const database = getConnection();
  const organization: Validation = new Validation();
  organization.guild = guild.name;
  organization.validation_is_mainnet = isMainnet;

  // Get last validation of organization, needed to only inform user about changes in validation, but not about already informed problems
  let lastValidation: Validation = await database.manager.findOne(Validation, {
    where: [
      {
        id: isMainnet ? guild.mainnet_last_validation_id : guild.testnet_last_validation_id,
      },
    ],
  });

  // If there is no last validation, create dummy object to prevent operations on undefined
  if (!lastValidation) {
    lastValidation = new Validation();
  }

  /**
   * ====================================================================================
   * 1. REGGED INFORMATION TESTS
   * ====================================================================================
   */

  /**
   * Test 1.1: Regged Location
   */
  const location: number = isMainnet ? guild.mainnet_location : guild.testnet_location;
  organization.reg_location_ok = location < 900 && location > 0;
  organization.reg_location = location;

  /**
   * Test 1.2: Regged Website
   */
  await http.get(url).then((response) => {
    organization.reg_website_ok = response.ok;
    organization.reg_website_ms = response.elapsedTimeInMilliseconds;
    organization.reg_website_message = response.getFormattedErrorMessage();
  });

  /**
   * ====================================================================================
   * 2. CHAINS.JSON TESTS
   * ====================================================================================
   */
  await http.get(url, "/chains.json").then(async (response) => {
    /**
     * Test 2.1: Chains.json exists at expected location and is valid Json
     */
    organization.chains_json_ok = response.ok && response.isJson();
    organization.chains_json_ms = response.elapsedTimeInMilliseconds;

    let chainsJsonMessage = "not found" + response.getFormattedErrorMessage();
    if (response.ok && !response.isJson()) {
      chainsJsonMessage = "is not a valid json";
    }
    organization.chains_json_message = chainsJsonMessage;

    /**
     * Test 2.2: Is access control allow origin header configured
     */
    // todo: check for double headers
    // Set status in database
    organization.chains_json_access_control_header_ok =
      response.headers !== undefined &&
      response.headers.has("access-control-allow-origin") &&
      response.headers.get("access-control-allow-origin") === "*";

    /**
     * Get path to bp.json
     */
    if (
      response.getDataItem(["chains", chainId]) !== undefined &&
      new RegExp(".*\\.json").test(response.getDataItem(["chains", chainId]))
    ) {
      pathToBpJson = response.getDataItem(["chains", chainId]);
    }
  });

  /**
   * ====================================================================================
   * 3. BP.JSON TESTS
   * ====================================================================================
   */

  let bpJsonIncorrectMessage = "";
  if (pathToBpJson) {
    await http.get(url, pathToBpJson).then(async (response) => {
      /**
       * Test 3.1: bp.json reachable
       */
      organization.bpjson_found = response.ok;

      // bp.json request was unsuccessful
      if (!response.ok) {
        bpJsonIncorrectMessage = "not reachable" + response.getFormattedErrorMessage();
        return;
      }

      /**
       * Test 3.1: Producer account name
       */
      // todo: improve regex to support max length and only valid characters
      let producerNameMessage = "was not provided";
      // A valid producer_account_name is provided in bp.json
      if (
        response.getDataItem(["producer_account_name"]) !== undefined &&
        new RegExp(".+").test(response.getDataItem(["producer_account_name"]))
      ) {
        // producer_account_name matches name provided on chain
        if (response.getDataItem(["producer_account_name"]) === guild.name) {
          // todo: check case sensitivity
          organization.bpjson_producer_account_name_ok = true;
          // producer_account_name does NOT match name provided on chain
        } else {
          organization.bpjson_producer_account_name_ok = false;
          producerNameMessage =
            "(" +
            response.getDataItem(["producer_account_name"]) +
            ") does not match name on chain (" +
            guild.name +
            ")";
        }
        // There is no valid producer_account_name in the bp.json
      } else {
        organization.bpjson_producer_account_name_ok = false;
      }
      organization.bpjson_producer_account_name_message = producerNameMessage

      /**
       * Test 3.2: candidate name
       */
      // Set status in database
      organization.bpjson_candidate_name_ok =
        response.getDataItem(["org", "candidate_name"]) !== undefined &&
        new RegExp(".+").test(response.getDataItem(["org", "candidate_name"]));

      /**
       * Test 3.3: website
       */
      await http.get(response.getDataItem(["org", "website"])).then((response) => {
        organization.bpjson_website_ok = response.ok;
        organization.bpjson_website_ms = response.elapsedTimeInMilliseconds;
        organization.bpjson_website_message = response.getFormattedErrorMessage();
      });

      /**
       * Test 3.4: Code of conduct
       */
      await http.get(response.getDataItem(["org", "code_of_conduct"])).then((response) => {
        organization.bpjson_code_of_conduct_ok = response.ok;
        organization.bpjson_code_of_conduct_ms = response.elapsedTimeInMilliseconds;
        organization.bpjson_code_of_conduct_message = response.getFormattedErrorMessage();
      });

      /**
       * Test 3.5: Ownership Disclosure
       */
      await http.get(response.getDataItem(["org", "ownership_disclosure"])).then((response) => {
        organization.bpjson_ownership_disclosure_ok = response.ok;
        organization.bpjson_ownership_disclosure_ms = response.elapsedTimeInMilliseconds;
        organization.bpjson_ownership_disclosure_message = response.getFormattedErrorMessage();
      });

      /**
       * Test 3.6: email
       */
      let emailIncorrectMessage = "";
      // Valid email field in bp.json
      if (response.getDataItem(["org", "email"]) !== undefined) {
        // Check if email if formatted correctly
        organization.bpjson_email_ok = new RegExp(".+@.+\\..+").test(response.getDataItem(["org", "email"]));

        if (!organization.bpjson_email_ok)
          emailIncorrectMessage = "has an invalid format: " + response.getDataItem(["org", "email"]);

        // No email field is provided in bp.json
      } else {
        organization.bpjson_email_ok = false;
        emailIncorrectMessage = "was not provided";
      }
      organization.bpjson_email_message = emailIncorrectMessage;

      /**
       * Test : GitHub User
       */
      let gitHubUserIncorrectMessage = "";
      if (response.getDataItem(["org", "github_user"]) !== undefined) {
        // Get github_user from json
        const gitHubUserObj = response.getDataItem(["org", "github_user"]);

        // More than one GitHub user supplied
        if (Array.isArray(gitHubUserObj)) {
          gitHubUserIncorrectMessage = "was provided but has invalid formatting (";
          organization.bpjson_github_user_ok = true;

          // Check array length
          if (gitHubUserObj.length === 0) {
            gitHubUserIncorrectMessage += "an empty array was provided";
            organization.bpjson_github_user_ok = false;
          }

          // Iterate over array
          for (const gitHubUser of gitHubUserObj) {
            if (
              !(
                new RegExp(".+").test(gitHubUser) &&
                !new RegExp("https?://.+").test(gitHubUser.toLowerCase()) &&
                !new RegExp("^@").test(gitHubUser)
              )
            ) {
              gitHubUserIncorrectMessage += (organization.bpjson_github_user_ok ? "" : ", ") + gitHubUser;
              organization.bpjson_github_user_ok = false;
            }
          }
          gitHubUserIncorrectMessage += ")";

          // One GitHub user supplied
        } else {
          organization.bpjson_github_user_ok =
            new RegExp(".+").test(gitHubUserObj) &&
            !new RegExp("https?://.+").test(gitHubUserObj.toLowerCase()) &&
            !new RegExp("^@").test(gitHubUserObj);

          gitHubUserIncorrectMessage = "was provided, but has invalid formatting (" + gitHubUserObj + ")";
        }
      } else {
        gitHubUserIncorrectMessage = "was not provided";
        organization.bpjson_github_user_ok = false;
      }
      organization.bpjson_github_user_message = gitHubUserIncorrectMessage;

      /**
       * Test 3. : Chain resources
       */
      let chainResourcesIncorrectMessage = "";
      if (response.getDataItem(["org", "chain_resources"]) !== undefined) {
        try {
          new URL(response.getDataItem(["org", "chain_resources"]));
          organization.bpjson_chain_resources_ok = true;
        } catch (e) {
          organization.bpjson_chain_resources_ok = false;
          chainResourcesIncorrectMessage = "is not a valid url";

          if (Array.isArray(response.getDataItem(["org", "chain_resources"])))
            chainResourcesIncorrectMessage += ". Arrays are not allowed";
        }
      } else {
        organization.bpjson_chain_resources_ok = false;
        chainResourcesIncorrectMessage = "was not provided";
      }
      organization.bpjson_chain_resources_message = chainResourcesIncorrectMessage;

      /**
       * Test 3. : Other resources
       */
      organization.bpjson_other_resources_ok = true;
      let otherResourcesIncorrectMessage = "are invalid: ";
      if (response.getDataItem(["org", "other_resources"]) !== undefined) {
        const resourcesArray = response.getDataItem(["org", "other_resources"]);

        if (Array.isArray(resourcesArray)) {
          resourcesArray.forEach((resource) => {
            try {
              new URL(resource);
            } catch (e) {
              if (!organization.bpjson_other_resources_ok) otherResourcesIncorrectMessage += ", ";

              otherResourcesIncorrectMessage += resource + "(invalid url)";
              organization.bpjson_other_resources_ok = false;
            }
          });
        } else {
          otherResourcesIncorrectMessage = "are not a valid array";
          organization.bpjson_other_resources_ok = false;
        }
      } else {
        otherResourcesIncorrectMessage = "were not provided";
        organization.bpjson_other_resources_ok = false;
      }
      organization.bpjson_other_resources_message = otherResourcesIncorrectMessage;

      /**
       * Test 3.7: branding
       */
      let brandingIncorrectMessage = "invalid";
      // todo: check if array check is necessary
      if (
        response.getDataItem(["org", "branding"]) !== undefined &&
        Object.keys(response.getDataItem(["org", "branding"])).length >= 3
      ) {
        let successfulBrandingRequests = 0;
        // Logo 256px
        await http.get(response.getDataItem(["org", "branding", "logo_256"])).then((response) => {
          // Successful request and logo is in right format
          if (response.ok && new RegExp("image/(png|jpg]).*").test(response.headers.get("content-type"))) {
            successfulBrandingRequests++;
          }
          // Successful request but logo is not right format
          if (response.ok) {
            brandingIncorrectMessage += ", logo_256 (wrong format)";
          }
          // Request was not successful
          else {
            brandingIncorrectMessage += ", logo_256 (" + response.errorMessage + ")";
          }
        });

        // Logo 1024px
        await http.get(response.getDataItem(["org", "branding", "logo_1024"])).then((response) => {
          // Successful request and logo is in right format
          if (response.ok && new RegExp("image/(png|jpg]).*").test(response.headers.get("content-type"))) {
            successfulBrandingRequests++;
          }
          // Successful request but logo is not right format
          if (response.ok) {
            brandingIncorrectMessage += ", logo_1024 (wrong format)";
          }
          // Request was not successful
          else {
            brandingIncorrectMessage += ", logo_1024 (" + response.errorMessage + ")";
          }
        });

        // Logo svg
        await http.get(response.getDataItem(["org", "branding", "logo_svg"])).then((response) => {
          // Successful request and logo is in right format
          if (response.ok && new RegExp("image/svg.*").test(response.headers.get("content-type"))) {
            successfulBrandingRequests++;
          }
          // Successful request but logo is not right format
          if (response.ok) {
            brandingIncorrectMessage += ", logo_svg (wrong format)";
          }
          // Request was not successful
          else {
            brandingIncorrectMessage += ", logo_svg (" + response.errorMessage + ")";
          }
        });

        // Branding is only valid if all branding checks were successful
        organization.bpjson_branding_ok = successfulBrandingRequests >= 3;
      } else {
        organization.bpjson_branding_ok = false;
        brandingIncorrectMessage = "not provided in all three formats";
      }

      organization.bpjson_branding_message = brandingIncorrectMessage;

      /**
       * Test 3.8: location
       */
      organization.bpjson_location_ok =
        response.getDataItem(["org", "location"]) !== undefined &&
        validateBpLocation(response.getDataItem(["org", "location"]));

      /**
       * Test 3.9: social
       */
      if (response.getDataItem(["org", "social"])) {
        let validSocialReferences = 0;

        const validSocialServices: Array<string> = config.get("validation.social_services");
        for (const socialServices of Object.keys(response.getDataItem(["org", "social"]))) {
          const username: string = response.getDataItem(["org", "social", socialServices]);

          // urls or usernames with '@' are not allowed
          if (
            validSocialServices.includes(socialServices.toLowerCase()) &&
            new RegExp(".+").test(username) &&
            !new RegExp("https?://.+").test(username.toLowerCase()) &&
            !new RegExp("^@").test(username)
          ) {
            validSocialReferences++;
          }
        }
        // There must be at least 4 valid social references
        organization.bpjson_social_ok = validSocialReferences >= 4;
      } else {
        organization.bpjson_social_ok = false;
      }

      /**
       * ====================================================================================
       * NODES VALIDATION TRIGGERED FROM HERE
       * ====================================================================================
       */
      if (response.getDataItem(["nodes"]) !== undefined && Object.keys(response.getDataItem(["nodes"])).length >= 1) {
        organization.nodes_api = [];
        organization.nodes_seed = [];
        organization.nodes_producer_found = false;

        for (const node of response.getDataItem(["nodes"])) {
          if (node["node_type"]) {
            const locationOk: boolean = validateBpLocation(node.location);
            /**
             * Test 3.11: Check if producer is listed
             */
            if (
              node.node_type == "producer" ||
              (Array.isArray(node.node_type) && node.node_type.includes("producer"))
            ) {
              if (!organization.nodes_producer_found) organization.nodes_producer_found = locationOk;
            }
            if (node.node_type == "seed" || (Array.isArray(node.node_type) && node.node_type.includes("seed"))) {
              /**
               * Test 3.12: Test P2P Nodes
               */
              // Get last validation from database with same endpoint url
              let lastSeedValidation: NodeSeed;
              if (lastValidation && lastValidation.nodes_seed) {
                lastSeedValidation = lastValidation.nodes_seed.find((seed) => {
                  return seed.p2p_endpoint === node.p2p_endpoint;
                });
              }

              // Validate Seed Endpoint
              let seedNode: NodeSeed;
              if (lastSeedValidation.validation_date.valueOf() <= Date.now() - ((config.get("validation.validation_seed_offset") - 0.5) * config.get("validation.validation_round_interval"))) {
                seedNode = await seed.validateAll(
                  guild,
                  isMainnet,
                  node.p2p_endpoint,
                  locationOk
                );
              } else {
                seedNode = lastSeedValidation;
              }

              // Add seed validation to organization object, if it is not undefined (e.g. undefined if no url was provided)
              if (seedNode) {
                organization.nodes_seed.push(seedNode);
              }
            }
            if ((node.node_type == "query" || (Array.isArray(node.node_type) && node.node_type.includes("query"))) && Array.isArray(node.features)) {
              if (node.node_type.includes("chain-api")) {
                /**
                 * Test 3.13: Test NodeApi Nodes
                 */
                  // Validate Http endpoint
                const apiNode: NodeApi = await api.validateAll(
                  guild,
                  isMainnet,
                  node.api_endpoint,
                  false,
                  locationOk,
                  node.features
                  );
                // Add NodeApi validation to organization object, if it is not undefined (e.g. undefined if no url was provided)
                if (apiNode) {
                  organization.nodes_api.push(apiNode);
                }

                // Validate Https endpoint
                const sslNode: NodeApi = await api.validateAll(
                  guild,
                  isMainnet,
                  node.ssl_endpoint,
                  true,
                  locationOk,
                  node.features
                );
                // Add NodeApi validation to organization object, if it is not undefined (e.g. undefined if no url was provided)
                if (sslNode) {
                  organization.nodes_api.push(sslNode);
                }
              }

              if (node.node_type.includes("history-v1")) {

              }

              if (node.node_type.includes("hyperion-v2")) {

              }

              if (node.node_type.includes("atomic-assets-api")) {

              }
            }
          }
        }
      }
    });
  } else {
    bpJsonIncorrectMessage = "not provided";
    organization.bpjson_found = false;
  }

  // General status of bp.json
  // Create Explanation for Pager Messages and locally stored .json
  organization.bpjson_found_message = bpJsonIncorrectMessage;

  /**
   * SAVE results to database
   */

  // Store Validation object to Database
  await database.manager.save(organization);
  childLogger.debug(
    "SAVED \t New organization validation for " +
      guild.name +
      " " +
      (isMainnet ? "mainnet" : "testnet") +
      " to database"
  );

  // Update last validation field in guild table
  if (isMainnet) {
    await database.manager.update(Guild, guild.name, {
      mainnet_last_validation_id: organization.id,
    });
  } else {
    await database.manager.update(Guild, guild.name, {
      testnet_last_validation_id: organization.id,
    });
  }

  // It must be returned a dummy promise, so the parent function calling this function waits until all validations are completed
  return Promise.resolve(true);
}

/**
 * Verifies a location field used by the bp.json schema
 * Do NOT use for location verification of on chain producer information
 * @param {object} location = json formatted object in the following schema: "name", "country", "latitude", "longitude"
 * @return {boolean} = is true if all location checks have passed
 */
function validateBpLocation(location: any): boolean {
  let successfulLocationTests = 0;

  // Name
  if (RegExp(".+").test(location["name"])) {
    successfulLocationTests++;
  } else {
    childLogger.debug("FALSE \t Invalid location name");
  }
  // Country: Should be two digit upper case country code
  if (RegExp("[A-Z]{2}").test(location["country"]) && location["country"].length == 2) {
    successfulLocationTests++;
  } else {
    childLogger.debug("FALSE \t Invalid Country code. Should be two digit country code and upper case.");
  }
  // Latitude: should be between -90 and 90
  if (Math.abs(Number.parseFloat(location["latitude"])) <= 90) {
    successfulLocationTests++;
  } else {
    childLogger.debug("FALSE \t Invalid location latitude out of range");
  }
  // Longitude: should be between -180 and 180
  if (Math.abs(Number.parseFloat(location["longitude"])) <= 180) {
    successfulLocationTests++;
  } else {
    childLogger.debug("FALSE \t Invalid location longitude");
  }
  if (Number.parseFloat(location["longitude"]) == 0 && Number.parseFloat(location["latitude"]) == 0) {
    childLogger.debug("FALSE \t Your location would be in the atlantic ocean ;-)");
    return false;
  }

  return successfulLocationTests == 4;
}


/*
              OLD CODE

              // Get last validation from database with same endpoint url
              // Stores the last validation for http endpoint
              let lastApiValidation: NodeApi;
              // Stores the last validation for httpS endpoint
              let lastSslValidation: NodeApi;

              if (lastValidation && lastValidation.nodes_api) {
                lastApiValidation = lastValidation.nodes_api.find((api) => {
                  return api.api_endpoint === node.api_endpoint;
                });
                lastSslValidation = lastValidation.nodes_api.find((api) => {
                  return api.api_endpoint === node.ssl_endpoint;
                });
              }



 */