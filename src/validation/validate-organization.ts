import * as api from "./validate-api";
import * as seed from "./validate-seed";
import * as config from "config";
import { logger } from "../common";
import { Organization } from "../database/entity/Organization";
import "reflect-metadata";
import { getConnection } from "typeorm";
import { Guild } from "../database/entity/Guild";
import { Logger } from "tslog";
import { sendMessageOrganization } from "../telegramHandler";
import { evaluateMessage, convertArrayToJsonWithHeader, writeJsonToDisk } from "../messageHandler";
import { Api } from "../database/entity/Api";
import { Seed } from "../database/entity/Seed";
import * as http from "../httpConnection/newHttpRequest";

/**
 * Logger Settings for Organization
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

  // Stores all validation explanations for organization
  const validationMessages: Array<[string, boolean]> = [];

  // After each validation a json with all validation messages is stored to disk
  let jsonString = "{\n" + '"guild": "' + guild.name + '", \n';
  jsonString += '"isMainnet": ' + isMainnet + ", ";
  const seedJsons: Array<string> = [];
  const apiJsons: Array<string> = [];
  const historyJsons: Array<string> = [];

  // Create organization object for database
  const database = getConnection();
  const organization: Organization = new Organization();
  organization.guild = guild.name;
  organization.validation_is_mainnet = isMainnet;

  // Get last validation of organization, needed to only inform user about changes in validation, but not about already informed problems
  let lastValidation: Organization = await database.manager.findOne(Organization, {
    where: [
      {
        id: isMainnet ? guild.mainnet_last_validation_id : guild.testnet_last_validation_id,
      },
    ],
  });

  // If there is no last validation, create dummy object to prevent operations on undefined
  if (!lastValidation) {
    lastValidation = new Organization();
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

  // Set status in database
  organization.reg_location_ok = location < 900 && location > 0;

  // Create Explanation for Pager Messages and locally stored .json
  validationMessages.push(
    evaluateMessage(
      lastValidation.reg_location_ok,
      organization.reg_location_ok,
      "Location (" + location + ") on Chain is",
      "valid",
      "invalid"
    )
  );

  /**
   * Test 1.2: Regged Website
   */
  await http.request(url).then((response) => {
    // Set status in database
    organization.reg_website_ok = response.ok;
    organization.reg_website_ms = response.elapsedTimeInMilliseconds;

    // Create Explanation for Pager Messages and locally stored .json
    validationMessages.push(
      evaluateMessage(
        lastValidation.reg_website_ok,
        organization.reg_website_ok,
        "Website registered on Chain is",
        "reachable",
        "not reachable or was not provided" + response.getFormattedErrorMessage()
      )
    );
  });

  /**
   * ====================================================================================
   * 2. CHAINS.JSON TESTS
   * ====================================================================================
   */
  await http.request(url, "/chains.json").then(async (response) => {
    /**
     * Test 2.1: Chains.json exists at expected location and is valid Json
     */
    organization.chains_json_ok = response.ok && response.isJson();
    organization.chains_json_ms = response.elapsedTimeInMilliseconds;

    let chainsJsonMessage = "not found" + response.getFormattedErrorMessage();
    if (response.ok && !response.isJson()) {
      chainsJsonMessage = "is not a valid json";
    }

    // Create Explanation for Pager Messages and locally stored .json
    validationMessages.push(
      evaluateMessage(
        lastValidation.chains_json_ok,
        organization.chains_json_ok,
        "Chains.json",
        "found and with valid json formatting",
        chainsJsonMessage
      )
    );

    /**
     * Test 2.2: Is access control allow origin header configured
     */
    // todo: check for double headers
    // Set status in database
    organization.chains_json_access_control_header_ok =
      response.headers.has("access-control-allow-origin") && response.headers.get("access-control-allow-origin") === "*";

    // Create Explanation for Pager Messages and locally stored .json
    validationMessages.push(
      evaluateMessage(
        lastValidation.chains_json_access_control_header_ok,
        organization.chains_json_access_control_header_ok,
        "Chains.json Access-control-allow-origin header",
        "configured properly",
        "not configured properly"
      )
    );

    /**
     * Get path to bp.json
     */
    if (response.getDataItem(["chains", chainId]) !== undefined && new RegExp(".*\\.json").test(response.getDataItem(["chains", chainId]))) {
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
    await http.request(url, pathToBpJson).then(async (response) => {
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
      if (response.getDataItem(["producer_account_name"]) !== undefined && new RegExp(".+").test(response.getDataItem(["producer_account_name"]))) {
        // producer_account_name matches name provided on chain
        if (response.getDataItem(["producer_account_name"]) === guild.name) {
          // todo: check case sensitivity
          organization.bpjson_producer_account_name_ok = true;
          // producer_account_name does NOT match name provided on chain
        } else {
          organization.bpjson_producer_account_name_ok = false;
          producerNameMessage =
            "(" + response.getDataItem(["producer_account_name"]) + ") does not match name on chain (" + guild.name + ")";
        }
        // There is no valid producer_account_name in the bp.json
      } else {
        organization.bpjson_producer_account_name_ok = false;
      }

      // Create Explanation for Pager Messages and locally stored .json
      validationMessages.push(
        evaluateMessage(
          lastValidation.bpjson_producer_account_name_ok,
          organization.bpjson_producer_account_name_ok,
          "Producer account name in " + pathToBpJson,
          "is valid",
          producerNameMessage
        )
      );

      /**
       * Test 3.2: candidate name
       */
      // Set status in database
      organization.bpjson_candidate_name_ok =
        response.getDataItem(["org", "candidate_name"]) !== undefined &&
        new RegExp(".+").test(response.getDataItem(["org", "candidate_name"]));

      // Create Explanation for Pager Messages and locally stored .json
      validationMessages.push(
        evaluateMessage(
          lastValidation.bpjson_candidate_name_ok,
          organization.bpjson_candidate_name_ok,
          "Candidate name in " + pathToBpJson + " is",
          "valid",
          "not valid"
        )
      );

      /**
       * Test 3.3: website
       */
        await http.request(response.getDataItem(["org","website"])).then((response) => {
          organization.bpjson_website_ok = response.ok;
          organization.bpjson_website_ms = response.elapsedTimeInMilliseconds;

          // Create Explanation for Pager Messages and locally stored .json
          validationMessages.push(
            evaluateMessage(
              lastValidation.bpjson_candidate_name_ok,
              organization.bpjson_candidate_name_ok,
              "Website in " + pathToBpJson,
              "is reachable",
              "is not reachable" + response.getFormattedErrorMessage()
            )
          );
        });

      /**
       * Test 3.4: Code of conduct
       */
        await http.request(response.getDataItem(["org", "code_of_conduct"])).then((response) => {
          organization.bpjson_code_of_conduct_ok = response.ok;
          organization.bpjson_code_of_conduct_ms = response.elapsedTimeInMilliseconds;

          // Create Explanation for Pager Messages and locally stored .json
          validationMessages.push(
            evaluateMessage(
              lastValidation.bpjson_code_of_conduct_ok,
              organization.bpjson_code_of_conduct_ok,
              "Code of conduct in " + pathToBpJson,
              "is reachable.",
              "is not reachable" + response.getFormattedErrorMessage()
            )
          );
        });

      /**
       * Test 3.5: Ownership Disclosure
       */
        await http.request(response.getDataItem(["org", "ownership_disclosure"])).then((response) => {
          organization.bpjson_ownership_disclosure_ok = response.ok;
          organization.bpjson_ownership_disclosure_ms = response.elapsedTimeInMilliseconds;

          // Create Explanation for Pager Messages and locally stored .json
          validationMessages.push(
            evaluateMessage(
              lastValidation.bpjson_ownership_disclosure_ok,
              organization.bpjson_ownership_disclosure_ok,
              "Ownership Disclosure in " + pathToBpJson,
              "is reachable",
              "is not reachable" + response.getFormattedErrorMessage()
            )
          );
        });

      /**
       * Test 3.6: email
       */
      let emailIncorrectMessage = "";
      // Valid email field in bp.json
      if (response.getDataItem(["org","email"]) !== undefined) {
        // Check if email if formatted correctly
        organization.bpjson_email_ok =
          new RegExp(".+@.+\\..+").test(response.getDataItem(["org","email"]));

        if (!organization.bpjson_email_ok)
          emailIncorrectMessage = "has an invalid format: " + response.getDataItem(["org", "email"]);

        // No email field is provided in bp.json
      } else {
        organization.bpjson_email_ok = false;
        emailIncorrectMessage = "was not provided";
      }

      // Create Explanation for Pager Messages and locally stored .json
      validationMessages.push(
        evaluateMessage(
          lastValidation.bpjson_email_ok,
          organization.bpjson_email_ok,
          "Email in " + pathToBpJson,
          "is valid",
          emailIncorrectMessage
        )
      );

      /**
       * Test : GitHub User
       */

      // todo: add organization github_user database
      let gitHubUserIncorrectMessage = "";
      if (response.getDataItem(["org", "github_user"]) !== undefined) {
        // Get github_user from json
        const gitHubUserObj = response.getDataItem(["org", "github_user"]);

        // More than one GitHub user supplied
        if (Array.isArray(gitHubUserObj)) {
          let allUsersOk = gitHubUserObj.length >= 1;
          gitHubUserIncorrectMessage = "was provided but has invalid formatting (";

          for (const gitHubUser of gitHubUserObj) {
            if (
              !(
                new RegExp(".+").test(gitHubUser) &&
                !new RegExp("https?://.+").test(gitHubUser.toLowerCase()) &&
                !new RegExp("^@").test(gitHubUser)
              )
            ) {
              gitHubUserIncorrectMessage += (allUsersOk ? "" : ", ") + gitHubUser;
              allUsersOk = false;
            }
          }

          gitHubUserIncorrectMessage += ")";

          // One GitHub user supplied
        } else {
          const githubuserstate =
            new RegExp(".+").test(gitHubUserObj) &&
            !new RegExp("https?://.+").test(gitHubUserObj.toLowerCase()) &&
            !new RegExp("^@").test(gitHubUserObj);

          if (!githubuserstate)
            gitHubUserIncorrectMessage = "was provided, but has invalid formatting (" + gitHubUserObj + ")";
        }
      } else {
        gitHubUserIncorrectMessage = "was not provided";
      }

      // Create Explanation for Pager Messages and locally stored .json
      validationMessages.push(
        evaluateMessage(
          lastValidation.bpjson_email_ok,
          organization.bpjson_email_ok,
          "GitHub user in " + pathToBpJson,
          "was provided (min. 1)",
          gitHubUserIncorrectMessage
        )
      );

      /**
       * Test 3. : Chain resources
       */
      // state = true
      if (response.getDataItem(["org", "chain_resources"]) !== undefined) {
        try {
          new URL(response.getDataItem(["org", "chain_resources"]));
        } catch (e) {
          // state = false
        }
      }

      // Create Explanation for Pager Messages and locally stored .json
      validationMessages.push(
        evaluateMessage(
          lastValidation.bpjson_email_ok,
          organization.bpjson_email_ok,
          "Chain resources in " + pathToBpJson,
          "is valid",
          "is not a valid url. Arrays are not allowed"
        )
      );

      /**
       * Test 3. : Other resources
       */
      // state = true
      let otherResourcesIncorrectMessage = "are invalid: ";
      if (response.getDataItem(["org", "other_resources"]) !== undefined) {
        const resourcesArray = response.getDataItem(["org", "other_resources"]);

        if (Array.isArray(resourcesArray)) {
          resourcesArray.forEach((resource) => {
            try {
              new URL(resource);
            } catch (e) {
              /*
                if (!state)
                  otherResourcesIncorrectMessage += ", "
                 */
              otherResourcesIncorrectMessage += resource + "(invalid url)";
              // state = false
            }
          });
        } else {
          // state = false
          otherResourcesIncorrectMessage = "are not a valid array";
        }
      }
      // Create Explanation for Pager Messages and locally stored .json
      validationMessages.push(
        evaluateMessage(
          lastValidation.bpjson_email_ok,
          organization.bpjson_email_ok,
          "Other resources in " + pathToBpJson,
          "are valid",
          otherResourcesIncorrectMessage
        )
      );

      /**
       * Test 3.7: branding
       */
      let brandingIncorrectMessage = "invalid";
      // todo: check if array check is necessary
      if (response.getDataItem(["org", "branding"]) !== undefined && Object.keys(response.getDataItem(["org", "branding"])).length >= 3) {
        let successfulBrandingRequests = 0;
        // Logo 256px
        await http.request(response.getDataItem(["org", "branding", "logo_256"])).then((response) => {
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
        await http.request(response.getDataItem(["org", "branding", "logo_1024"])).then((response) => {
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
        await http.request(response.getDataItem(["org", "branding", "logo_svg"])).then((response) => {
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

      // Create Explanation for Pager Messages and locally stored .json
      validationMessages.push(
        evaluateMessage(
          lastValidation.bpjson_branding_ok,
          organization.bpjson_branding_ok,
          "Branding in " + pathToBpJson,
          "provided in all three formats",
          brandingIncorrectMessage
        )
      );

      /**
       * Test 3.8: location
       */
      organization.bpjson_location_ok = response.getDataItem(["org", "location"]) !== undefined && validateBpLocation(response.getDataItem(["org", "location"]));

      // Create Explanation for Pager Messages and locally stored .json
      validationMessages.push(
        evaluateMessage(
          lastValidation.bpjson_location_ok,
          organization.bpjson_location_ok,
          "Location of your organization in " + pathToBpJson,
          "is valid.",
          "is invalid."
        )
      );
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

      // Create Explanation for Pager Messages and locally stored .json
      validationMessages.push(
        evaluateMessage(
          lastValidation.bpjson_social_ok,
          organization.bpjson_social_ok,
          "Social Services in " + pathToBpJson,
          "are valid",
          "are either not provided (min. 4 required) or some are invalid (no urls or @ before username allowed)."
        )
      );

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
            if (node.node_type == "producer") {
              if (!organization.nodes_producer_found) organization.nodes_producer_found = locationOk;
            } else if (node.node_type == "seed") {
              /**
               * Test 3.12: Test P2P Nodes
               */

              // Get last validation from database with same endpoint url
              let lastSeedValidation: Seed;
              if (lastValidation && lastValidation.nodes_seed) {
                lastSeedValidation = lastValidation.nodes_seed.find((seed) => {
                  return seed.p2p_endpoint === node.p2p_endpoint;
                });
              }

              // Validate Seed Endpoint
              const seedNode: [Seed, string] = await seed.validateAll(
                guild,
                lastSeedValidation,
                isMainnet,
                node.p2p_endpoint,
                locationOk
              );

              // Add seed validation to organization object, if it is not undefined (e.g. undefined if no url is provided)
              if (Array.isArray(seedNode) && seedNode[0] && seedNode[1]) {
                // Add relation to seed node to organization database object
                organization.nodes_seed.push(seedNode[0]);

                // Add seed validation messages to seed json array
                seedJsons.push(seedNode[1]);
              }
            } else if (node.node_type == "query") {
              /**
               * Test 3.13: Test Api Nodes
               */
              // Get last validation from database with same endpoint url
              // Stores the last validation for http endpoint
              let lastApiValidation: Api;

              // Stores the last validation for httpS endpoint
              let lastSslValidation: Api;
              if (lastValidation && lastValidation.nodes_api) {
                lastApiValidation = lastValidation.nodes_api.find((api) => {
                  return api.api_endpoint === node.api_endpoint;
                });
                lastSslValidation = lastValidation.nodes_api.find((api) => {
                  return api.api_endpoint === node.ssl_endpoint;
                });
              }

              // Validate Http endpoint
              const apiNode: [Api, string, string] = await api.validateAll(
                guild,
                isMainnet,
                lastApiValidation,
                node.api_endpoint,
                false,
                locationOk,
                node.features
              );
              // Add Api validation to organization object, if it is not undefined (e.g. undefined if no url is provided)
              if (Array.isArray(apiNode) && apiNode[0] && apiNode[1] && apiNode[2]) {
                // Add relation to api node to organization database object
                organization.nodes_api.push(apiNode[0]);

                // Add api validation messages to api json array
                apiJsons.push(apiNode[1]);

                // Add History validation message to history json array
                historyJsons.push(apiNode[2]);
              }

              // Validate Https endpoint
              const sslNode: [Api, string, string] = await api.validateAll(
                guild,
                isMainnet,
                lastSslValidation,
                node.ssl_endpoint,
                true,
                locationOk,
                node.features
              );

              // Add Api validation to organization object, if it is not undefined (e.g. undefined if no url is provided)
              if (Array.isArray(sslNode) && sslNode[0] && sslNode[1] && sslNode[2]) {
                // Add relation to ssl api node to organization database object
                organization.nodes_api.push(sslNode[0]);

                // Add ssl api validation messages to api json array
                apiJsons.push(sslNode[1]);

                // Add History validation message to history json array
                historyJsons.push(sslNode[2]);
              }
            }
          }
        }
      }

      // Create Explanation for Producer node
      // Note: Apis' and Seeds' Explanations are created in the validateAll methods
      // todo: add promises to ensure loop is finished before creating message
      validationMessages.push(
        evaluateMessage(
          lastValidation.nodes_producer_found,
          organization.nodes_producer_found,
          "",
          "At least one producer node with valid location in " + pathToBpJson,
          "No producer node with valid location in " + pathToBpJson
        )
      );
    });
  } else {
    bpJsonIncorrectMessage = "not provided";
    organization.bpjson_found = false;
  }

  // General status of bp.json
  // Create Explanation for Pager Messages and locally stored .json
  validationMessages.push(
    evaluateMessage(lastValidation.bpjson_found, organization.bpjson_found, "bp.json", "found", bpJsonIncorrectMessage)
  );

  /**
   * SAVE results to database
   */

  // Store Organization object to Database
  await database.manager.save(organization);
  childLogger.info(
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

  /**
   * Send Message to all subscribers of guild via. public telegram service
   */
  /*
  validationMessages = validationMessages.filter((message) => message);
  if (validationMessages.length > 0) sendMessageOrganization(guild.name, isMainnet, validationMessages);
   */

  jsonString += "\n" + convertArrayToJsonWithHeader("organization", validationMessages);
  jsonString += ',\n"api_nodes": [' + apiJsons.join(",\n") + "]";
  jsonString += ',\n"history_nodes": [' + historyJsons.join(",\n") + "]";
  jsonString += ',\n"seed_nodes": [' + seedJsons.join(",\n") + "]";
  jsonString += "\n}";

  await writeJsonToDisk(guild.name, isMainnet, jsonString);

  return Promise.resolve(true);
}

/**
 * Verifies a location field used by the bp.json schema
 * Do NOT use for location verification of on chain producer information
 * @param {object} location = json formatted object in the following schema: "name", "country", "latitude", "longitude"
 * @return {boolean} = is true if all location checks have passed
 */
function validateBpLocation(location: object): boolean {
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
