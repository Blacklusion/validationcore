import * as HttpRequest from "../httpConnection/HttpRequest";
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
import { evaluateMessage } from "../messageHandler";
import { Api } from "../database/entity/Api";
import { Seed } from "../database/entity/Seed";

/**
 * Logger Settings for Organization
 */
const childLogger: Logger = logger.getChildLogger({
  name: "Org-Validation",
});

/**
 * Validates regged producer information, chains.json and bp.json for specified guild
 * Only one chain (mainnet or testnet) will be evaluated
 * @param guild
 * @param isMainnet
 */
export async function validateAll(guild: Guild, isMainnet: boolean) {
  // Set general variables
  const url: string = isMainnet ? guild.mainnet_url : guild.testnet_url;
  const chainId: string = isMainnet ? config.get("mainnet.chain_id") : config.get("testnet.chain_id");
  let path: string;
  let pagerMessages: Array<[string, boolean]> = [];

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
  if (location < 900 && location > 0) {
    childLogger.debug("TRUE \t Valid Regged Location");
    organization.reg_location_ok = true;
  } else {
    childLogger.debug("FALSE \t Invalid Regged Location");
    organization.reg_location_ok = false;
  }
  pagerMessages.push(
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
  let reggedWebsiteMessage = "";
  await HttpRequest.get(url)
    .then((response) => {
      childLogger.debug("TRUE \t Regged Producer Website is online");
      organization.reg_website_ok = true;
      organization.reg_website_ms = response.elapsedTimeInMilliseconds;
    })
    .catch((error) => {
      childLogger.debug("FALSE \t Regged Producer Website is not reachable", error);
      organization.reg_website_ok = false;
      if (error.message) reggedWebsiteMessage = ": " + error.message;
    });
  pagerMessages.push(
    evaluateMessage(
      lastValidation.reg_website_ok,
      organization.reg_website_ok,
      "Website registered on Chain is",
      "reachable",
      "not reachable or was not provided" + reggedWebsiteMessage
    )
  );

  /**
   * ====================================================================================
   * 2. CHAINS.JSON TESTS
   * ====================================================================================
   */
  let chainsJsonMessage = "";
  await HttpRequest.get(url, "/chains.json")
    .then(async (response) => {
      /**
       * Test 2.1: Chains.json exists at expected location if promise is resolved
       */
      // todo: check if json
      childLogger.debug("TRUE \t Chains.json found at expected location ");
      organization.chains_json_ok = true;
      organization.chains_json_ms = response.elapsedTimeInMilliseconds;

      /**
       * Test 2.2: Is access control allow origin header configured
       */
      if (response.headers["access-control-allow-origin"] && response.headers["access-control-allow-origin"] === "*") {
        childLogger.debug("TRUE \t Chains.json Header has found access-control-allow-origin defined");
        organization.chains_json_access_control_header_ok = true;
      } else {
        childLogger.debug("FALSE \t Chains.json Header has not access-control-allow-origin defined");
        organization.chains_json_access_control_header_ok = false;
      }
      pagerMessages.push(
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
      if (response.data.chains && new RegExp(".*\\.json").test(response.data.chains[chainId])) {
        path = response.data.chains[chainId];
      }
    })
    .catch((error) => {
      childLogger.debug("FALSE \t Chains.json NOT found at expected location ", error);
      organization.chains_json_ok = false;
      if (error.message) chainsJsonMessage = ": " + error.message;
    });
  pagerMessages.push(
    evaluateMessage(
      lastValidation.chains_json_ok,
      organization.chains_json_ok,
      "Chains.json",
      "found",
      "not found" + chainsJsonMessage
    )
  );

  /**
   * ====================================================================================
   * 3. BP.JSON TESTS
   * ====================================================================================
   */

  let bpJsonMessage = "not found";
  if (!path) {
    childLogger.debug("FALSE \t Chains.json has not listed a bp.json for " + isMainnet ? "mainnet" : "testnet");
    organization.bpjson_found = false;
  } else {
    await HttpRequest.get(url, path)
      .then(async (response) => {
        /**
         * Test 3.1: bp.json reachable
         */
        childLogger.debug("TRUE \t Chains.json has listed a " + path);
        organization.bpjson_found = true;

        /**
         * Test 3.1: Producer account name
         */
        // todo: impove regex to suport max length and only valid characters
        let producerNameMessage = "was not provided";
        if (response.data["producer_account_name"] && new RegExp(".+").test(response.data["producer_account_name"])) {
          if (response.data["producer_account_name"] === guild.name) {
            childLogger.debug("TRUE \t Valid Producer account name");
            organization.bpjson_producer_account_name_ok = true;
          } else {
            childLogger.debug(
              "FALSE \t Valid Producer account name provided in bp.json but it does not match producer name on chain"
            );
            organization.bpjson_producer_account_name_ok = false;
            producerNameMessage =
              "(" + response.data["producer_account_name"] + ") does not match name on chain (" + guild.name + ")";
          }
        } else {
          childLogger.debug("FALSE \t Invalid Producer account name");
          organization.bpjson_producer_account_name_ok = false;
        }
        pagerMessages.push(
          evaluateMessage(
            lastValidation.bpjson_producer_account_name_ok,
            organization.bpjson_producer_account_name_ok,
            "Producer account name in " + path,
            "is correct",
            producerNameMessage
          )
        );

        /**
         * Test 3.2: candidate name
         */
        if (response.data.org && new RegExp(".+").test(response.data.org["candidate_name"])) {
          childLogger.debug("TRUE \t Valid Candidate account name");
          organization.bpjson_candidate_name_ok = true;
        } else {
          childLogger.debug("FALSE \t Invalid Candidate account name");
          organization.bpjson_candidate_name_ok = false;
        }
        pagerMessages.push(
          evaluateMessage(
            lastValidation.bpjson_candidate_name_ok,
            organization.bpjson_candidate_name_ok,
            "Candidate name in " + path + " is",
            "valid",
            "not valid"
          )
        );

        /**
         * Test 3.3: website
         */
        let websiteIncorrectMessage = "is not reachable.";
        if (response.data.org && response.data.org.website) {
          await HttpRequest.get(response.data.org["website"])
            .then((response) => {
              childLogger.debug("TRUE \t Valid website");
              organization.bpjson_website_ok = true;
              organization.bpjson_website_ms = response.elapsedTimeInMilliseconds;
            })
            .catch((error) => {
              childLogger.debug("FALSE \t Website is NOT reachable", error);
              organization.bpjson_website_ok = false;
              if (error.message) websiteIncorrectMessage += ": " + error.message;
            });
        } else {
          childLogger.debug("FALSE \t No website was provided");
          organization.bpjson_website_ok = false;
          websiteIncorrectMessage = "was not provided.";
        }
        pagerMessages.push(
          evaluateMessage(
            lastValidation.bpjson_candidate_name_ok,
            organization.bpjson_candidate_name_ok,
            "Website in " + path,
            "is reachable",
            websiteIncorrectMessage
          )
        );

        /**
         * Test 3.4: Code of conduct
         */
        let codeOfConductIncorrectMessage = "is not reachable.";
        if (response.data.org && response.data.org["code_of_conduct"]) {
          await HttpRequest.get(response.data.org["code_of_conduct"])
            .then((response) => {
              childLogger.debug("TRUE \t Valid code of conduct");
              organization.bpjson_code_of_conduct_ok = true;
              organization.bpjson_code_of_conduct_ms = response.elapsedTimeInMilliseconds;
            })
            .catch((error) => {
              childLogger.debug("FALSE \t Code of conduct NOT reachable", error);
              organization.bpjson_code_of_conduct_ok = false;
              codeOfConductIncorrectMessage += ": " + error.message;
            });
        } else {
          childLogger.debug("FALSE \t No code of conduct was provided");
          organization.bpjson_code_of_conduct_ok = false;
          codeOfConductIncorrectMessage = "was not provided.";
        }
        pagerMessages.push(
          evaluateMessage(
            lastValidation.bpjson_code_of_conduct_ok,
            organization.bpjson_code_of_conduct_ok,
            "Code of conduct in " + path,
            "is reachable.",
            codeOfConductIncorrectMessage
          )
        );

        /**
         * Test 3.5: Ownership Disclosure
         */
        let ownershipDisclosureIncorrectMessage = "is not reachable.";
        if (response.data.org && response.data.org["ownership_disclosure"]) {
          await HttpRequest.get(response.data.org["ownership_disclosure"])
            .then((response) => {
              childLogger.debug("TRUE \t Valid ownership disclosure");
              organization.bpjson_ownership_disclosure_ok = true;
              organization.bpjson_ownership_disclosure_ms = response.elapsedTimeInMilliseconds;
            })
            .catch((error) => {
              childLogger.debug("FALSE \t Ownership disclosure not reachable", error);
              organization.bpjson_ownership_disclosure_ok = false;
              ownershipDisclosureIncorrectMessage += ": " + error.message;
            });
        } else {
          childLogger.debug("FALSE \t No ownership disclosure was provided");
          organization.bpjson_ownership_disclosure_ok = false;
          ownershipDisclosureIncorrectMessage = "was not provided";
        }
        pagerMessages.push(
          evaluateMessage(
            lastValidation.bpjson_ownership_disclosure_ok,
            organization.bpjson_ownership_disclosure_ok,
            "Ownership Disclosure in " + path,
            "is reachable",
            ownershipDisclosureIncorrectMessage
          )
        );

        /**
         * Test 3.6: email
         */
        if (
          response.data.org &&
          response.data.org["email"] &&
          new RegExp(".+@.+\\..+").test(response.data.org["email"])
        ) {
          childLogger.debug("TRUE \t Valid email");
          organization.bpjson_email_ok = true;
        } else {
          childLogger.debug("FALSE \t Invalid email address or not email was provided");
          organization.bpjson_email_ok = false;
        }
        pagerMessages.push(
          evaluateMessage(
            lastValidation.bpjson_email_ok,
            organization.bpjson_email_ok,
            "Email in " + path,
            "is valid",
            "was not provided or has an invalid format"
          )
        );

        /**
         * Test 3.7: branding
         */
        let brandingMessage = "invalid";
        if (response.data.org && response.data.org.branding && Object.keys(response.data.org.branding).length >= 3) {
          let successfulBrandingRequests = 0;
          // Logo 256px
          await HttpRequest.get(response.data.org.branding["logo_256"])
            .then((response) => {
              if (new RegExp("image/(png|jpg]).*").test(response.headers["content-type"])) {
                successfulBrandingRequests++;
              } else {
                childLogger.debug("FALSE \t logo_256 in wrong format");
                brandingMessage += ", logo_256 (wrong format)";
              }
            })
            .catch((error) => {
              childLogger.debug("FALSE \t Invalid logo_256", error);
              if (error.message) brandingMessage += ", logo_256 (" + error.message + ")";
            });

          // Logo 1024px
          await HttpRequest.get(response.data.org.branding["logo_1024"])
            .then((response) => {
              if (new RegExp("image/(png|jpg).*").test(response.headers["content-type"])) {
                successfulBrandingRequests++;
              } else {
                childLogger.debug("FALSE \t logo_1024 in wrong format");
                brandingMessage += ", logo_1024 (wrong format)";
              }
            })
            .catch((error) => {
              childLogger.debug("FALSE \t Invalid logo_1024", error);
              if (error.message) brandingMessage += ", logo_1024 (" + error.message + ")";
            });

          // Logo svg
          await HttpRequest.get(response.data.org.branding["logo_svg"])
            .then((response) => {
              if (new RegExp("image/svg.*").test(response.headers["content-type"])) {
                successfulBrandingRequests++;
              } else {
                childLogger.debug("FALSE \t logo.svg in wrong format");
                brandingMessage += ", logo_svg (wrong format)";
              }
            })
            .catch((error) => {
              childLogger.debug("FALSE \t Invalid logo.svg", error);
              brandingMessage += ", logo_svg (" + error.message + ")";
            });

          // Branding is only valid if all branding checks were successful
          if (successfulBrandingRequests >= 3) {
            childLogger.debug("TRUE \t Valid branding");
            organization.bpjson_branding_ok = true;
          } else {
            childLogger.debug("FALSE \t Invalid branding");
            organization.bpjson_branding_ok = false;
          }
        } else {
          childLogger.debug("FALSE \t Invalid branding");
          organization.bpjson_branding_ok = false;
          brandingMessage = "not provided in all three formats";
        }
        pagerMessages.push(
          evaluateMessage(
            lastValidation.bpjson_branding_ok,
            organization.bpjson_branding_ok,
            "Branding in " + path,
            "provided in all three formats",
            brandingMessage
          )
        );

        /**
         * Test 3.8: location
         */
        if (response.data.org && response.data.org.location && validateBpLocation(response.data.org["location"])) {
          childLogger.debug("TRUE \t Valid location");
          organization.bpjson_location_ok = true;
        } else {
          childLogger.debug("FALSE \t Invalid location");
          organization.bpjson_location_ok = false;
        }
        pagerMessages.push(
          evaluateMessage(
            lastValidation.bpjson_location_ok,
            organization.bpjson_location_ok,
            "Location of your organization in " + path,
            "is valid.",
            "is invalid."
          )
        );
        /**
         * Test 3.9: social
         */
        if (response.data.org && response.data.org.social) {
          let validSocialReferences = 0;

          const validSocialServices: Array<string> = config.get("validation.social_services");
          for (const socialServices of Object.keys(response.data.org.social)) {
            const username: string = response.data.org.social[socialServices];

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
          if (validSocialReferences >= 4) {
            childLogger.debug("TRUE \t Valid social");
            organization.bpjson_social_ok = true;
          } else {
            childLogger.debug("FALSE \t Invalid social");
            organization.bpjson_social_ok = false;
          }
        } else {
          childLogger.debug("FALSE \t Invalid social");
          organization.bpjson_social_ok = false;
        }
        pagerMessages.push(
          evaluateMessage(
            lastValidation.bpjson_social_ok,
            organization.bpjson_social_ok,
            "Social Services in " + path,
            "are valid",
            "are either not provided (min. 4 required) or some are invalid (no urls or @ before username allowed)."
          )
        );

        /**
         * ====================================================================================
         * NODES VALIDATION TRIGGERED FROM HERE
         * ====================================================================================
         */
        if (response.data.nodes && Object.keys(response.data.nodes).length >= 1) {
          organization.nodes_api = [];
          organization.nodes_seed = [];
          organization.nodes_producer_found = false;

          for (const node of response.data.nodes) {
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
                let lastSeedValidation: Seed;
                if (lastValidation && lastValidation.nodes_seed) {
                  lastSeedValidation = lastValidation.nodes_seed.find((seed) => {
                    return seed.p2p_endpoint === node.p2p_endpoint;
                  });
                }
                const seedNode: Seed = await seed.validateAll(
                  guild,
                  lastSeedValidation,
                  isMainnet,
                  node.p2p_endpoint,
                  locationOk
                );
                if (seedNode) organization.nodes_seed.push(seedNode);
              } else if (node.node_type == "full" || node.node_type == "query") {
                /**
                 * Test 3.13: Test Api Nodes
                 */
                // Read last api validation from database with the same url
                let lastApiValidation: Api;
                let lastSslValidation: Api;
                if (lastValidation && lastValidation.nodes_api) {
                  lastApiValidation = lastValidation.nodes_api.find((api) => {
                    return api.api_endpoint === node.api_endpoint;
                  });
                  lastSslValidation = lastValidation.nodes_api.find((api) => {
                    return api.api_endpoint === node.ssl_endpoint;
                  });
                }
                const apiNode: Api = await api.validateAll(
                  guild,
                  isMainnet,
                  lastApiValidation,
                  node.api_endpoint,
                  false,
                  locationOk
                );
                if (apiNode) organization.nodes_api.push(apiNode);

                const sslNode: Api = await api.validateAll(
                  guild,
                  isMainnet,
                  lastSslValidation,
                  node.ssl_endpoint,
                  true,
                  locationOk
                );
                if (sslNode) organization.nodes_api.push(sslNode);
              }
            }
          }
          pagerMessages.push(
            evaluateMessage(
              lastValidation.nodes_producer_found,
              organization.nodes_producer_found,
              "",
              "At least one producer node with valid location in " + path,
              "No producer node with valid location in " + path
            )
          );
        } else {
          console.log("*** FALSE *** Invalid nodes");
        }
      })
      .catch((error) => {
        if (error.message) {
          bpJsonMessage = "not reachable: " + error.message;
        }
      });
  }
  pagerMessages.push(
    evaluateMessage(lastValidation.bpjson_found, organization.bpjson_found, "bp.json", "found", bpJsonMessage)
  );

  /**
   * Store results in Database and update last validation field in guild table
   */
  await database.manager.save(organization);
  childLogger.info(
    "SAVED \t New organization validation for " +
      guild.name +
      " " +
      (isMainnet ? "mainnet" : "testnet") +
      " to database"
  );
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
  pagerMessages = pagerMessages.filter((message) => message);
  if (pagerMessages.length > 0)
    sendMessageOrganization(
      guild.name,
      isMainnet,
      pagerMessages
    );
}

/**
 * Verifies a location field used by the bp.json schema
 * Do NOT use for location verification of on chain producer information
 * @param location = json formatted object in the following schema: "name", "country", "latitude", "longitude"
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
