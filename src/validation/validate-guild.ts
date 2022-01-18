import * as api from "./validate-api";
import * as wallet from "./validate-wallet";
import * as history from "./validate-history";
import * as hyperion from "./validate-hyperion";
import * as atomic from "./validate-atomic";
import * as seed from "./validate-seed";
import * as config from "config";
import {
  allChecksOK,
  calculateValidationLevel,
  logger, validateBpLocation
} from "../validationcore-database-scheme/common";
import { Validation } from "../validationcore-database-scheme/entity/Validation";
import "reflect-metadata";
import { getConnection } from "typeorm";
import { Guild } from "../validationcore-database-scheme/entity/Guild";
import { Logger } from "tslog";
import { NodeApi } from "../validationcore-database-scheme/entity/NodeApi";
import { NodeSeed } from "../validationcore-database-scheme/entity/NodeSeed";
import * as http from "../httpConnection/HttpRequest";
import { NodeHistory } from "../validationcore-database-scheme/entity/NodeHistory";
import { NodeHyperion } from "../validationcore-database-scheme/entity/NodeHyperion";
import { NodeAtomic } from "../validationcore-database-scheme/entity/NodeAtomic";
import { isEmail, isURL } from "validator";
import { NodeWallet } from "../validationcore-database-scheme/entity/NodeWallet";
import { ValidationLevel } from "../validationcore-database-scheme/enum/ValidationLevel";
import { getChainsConfigItem } from "../validationcore-database-scheme/readConfig";

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
 * @param {string} chainId = chainId of chain that is validated
 */
export async function validateGuild(guild: Guild, chainId: string): Promise<boolean> {

  childLogger.debug("START \t New validation validation for " + guild.name + " " + getChainsConfigItem(chainId, "name"))

  // Set general variables
  const url: string = guild.url;
  let pathToBpJson: string;

  // Create validation object for database
  const database = getConnection(chainId);
  const validation: Validation = new Validation();
  validation.instance_id = config.get("general.instance_id");
  validation.guild = guild.name;

  /**
   * ====================================================================================
   * 1. REGGED INFORMATION TESTS
   * ====================================================================================
   */

  /**
   * Test 1.1: Regged Location
   */
  if (getChainsConfigItem(chainId, "guild_location")) {
    const location: number = guild.location;
    const regLocationOk = location < 900 && location > 0;
    validation.reg_location_ok = calculateValidationLevel(regLocationOk, chainId, "guild_location_level");
    validation.reg_location = location;
  }

  /**
   * Test 1.2: Regged Website
   */
  if (getChainsConfigItem(chainId, "guild_reg_website")) {
    validation.reg_website_url = url;
    await http.get(url).then((response) => {
      validation.reg_website_ok = calculateValidationLevel(response.ok, chainId, "guild_reg_website_level");
      validation.reg_website_ms = response.elapsedTimeInMilliseconds;
      validation.reg_website_errortype = response.errorType;
      validation.reg_website_httpcode = response.httpCode;
    });
  }

  /**
   * ====================================================================================
   * 2. CHAINS.JSON TESTS
   * ====================================================================================
   */
  await http.get(url, "/chains.json").then(async (response) => {
    if (getChainsConfigItem(chainId, "guild_chains_json")) {
      /**
       * Test 2.1: Chains.json exists at expected location and is valid Json
       */
      const chainJsonOk = response.ok && response.isJson();
      validation.chains_json_ok = calculateValidationLevel(chainJsonOk, chainId, "guild_chains_json_level");
      validation.chains_json_ms = response.elapsedTimeInMilliseconds;
      validation.chains_json_errortype = response.errorType;
      validation.chains_json_httpcode = response.httpCode;

      // todo: add hint to check formatting of json to graphql api

      /**
       * Test 2.2: Is access control allow origin header configured
       */
      // todo: check for double headers
      // Set status in database
      if (getChainsConfigItem(chainId, "guild_chains_json_access_control_header")) {
        const chainsJsonAccessControlHeaderOk =
          response.headers !== undefined &&
          response.headers.has("access-control-allow-origin") &&
          response.headers.get("access-control-allow-origin") === "*";
        validation.chains_json_access_control_header_ok = calculateValidationLevel(
          chainsJsonAccessControlHeaderOk,
          chainId,
          "guild_chains_json_access_control_header_level"
        );
      }
    }
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

  if (pathToBpJson) {
    await http.get(url, pathToBpJson).then(async (response) => {
      /**
       * Test 3.1: bp.json reachable
       */
      if (getChainsConfigItem(chainId, "guild_bpjson")) {
        validation.bpjson_ok = calculateValidationLevel(response.ok, chainId, "guild_bpjson_level");
        validation.bpjson_ms = response.elapsedTimeInMilliseconds;
        validation.bpjson_path = pathToBpJson;
        validation.bpjson_errortype = response.errorType;
        validation.bpjson_httpcode = response.httpCode;
      }

      // bp.json request was unsuccessful and return to avoid checks of undefined
      if (!response.ok) {
        return;
      }

      /**
       * Test 3.1: Producer account name
       */
      if (getChainsConfigItem(chainId, "guild_bpjson_producer_name")) {
        // todo: improve regex to support max length and only valid characters
        // A valid producer_account_name is provided in bp.json
        if (
          response.getDataItem(["producer_account_name"]) !== undefined &&
          new RegExp(".+").test(response.getDataItem(["producer_account_name"]))
        ) {
          // producer_account_name matches name provided on chain
          if (response.getDataItem(["producer_account_name"]).toLowerCase() === guild.name.toLowerCase()) {
            validation.bpjson_producer_account_name_ok = calculateValidationLevel(
              true,
              chainId,
              "guild_bpjson_producer_name_level"
            );
            // producer_account_name does NOT match name provided on chain
          } else {
            validation.bpjson_producer_account_name_ok = calculateValidationLevel(
              false,
              chainId,
              "guild_bpjson_producer_name_level"
            );
            validation.bpjson_producer_account_name_message =
              "(" +
              response.getDataItem(["producer_account_name"]) +
              ") does not match name on chain (" +
              guild.name +
              ")";
          }
          // There is no valid producer_account_name in the bp.json
        } else {
          validation.bpjson_producer_account_name_ok = calculateValidationLevel(
            false,
            chainId,
            "guild_bpjson_producer_name_level"
          );
          validation.bpjson_producer_account_name_message = "was not provided";
        }
      }

      /**
       * Test 3.2: candidate name
       */
      if (getChainsConfigItem(chainId, "guild_bpjson_candidate_name")) {
        const candidateNameOk =
          response.getDataItem(["org", "candidate_name"]) !== undefined &&
          new RegExp(".+").test(response.getDataItem(["org", "candidate_name"]));
        validation.bpjson_candidate_name_ok = calculateValidationLevel(
          candidateNameOk,
          chainId,
          "guild_bpjson_candidate_name_level"
        );
      }

      /**
       * Test 3.3: website
       */
      if (getChainsConfigItem(chainId, "guild_bpjson_website")) {
          validation.bpjson_website_url = response.getDataItem(["org", "website"]);
        await http.get(response.getDataItem(["org", "website"])).then((response) => {
          validation.bpjson_website_ok = calculateValidationLevel(response.ok, chainId, "guild_bpjson_website_level");
          validation.bpjson_website_ms = response.elapsedTimeInMilliseconds;
          validation.bpjson_website_errortype = response.errorType;
          validation.bpjson_website_httpcode = response.httpCode;
        });
      }

      /**
       * Test 3.4: Code of conduct
       */
      if (getChainsConfigItem(chainId, "guild_bpjson_code_of_conduct")) {
        validation.bpjson_code_of_conduct_url = response.getDataItem(["org", "code_of_conduct"]);
        await http.get(response.getDataItem(["org", "code_of_conduct"])).then((response) => {
          validation.bpjson_code_of_conduct_ok = calculateValidationLevel(
            response.ok,
            chainId,
            "guild_bpjson_code_of_conduct_level"
          );
          validation.bpjson_code_of_conduct_ms = response.elapsedTimeInMilliseconds;
          validation.bpjson_code_of_conduct_errortype = response.errorType;
          validation.bpjson_code_of_conduct_httpcode = response.httpCode;
        });
      }

      /**
       * Test 3.5: Ownership Disclosure
       */
      if (getChainsConfigItem(chainId, "guild_bpjson_ownership_disclosure")) {
        validation.bpjson_ownership_disclosure_url = response.getDataItem(["org", "ownership_disclosure"]);
        await http.get(response.getDataItem(["org", "ownership_disclosure"])).then((response) => {
          validation.bpjson_ownership_disclosure_ok = calculateValidationLevel(
            response.ok,
            chainId,
            "guild_bpjson_ownership_disclosure_level"
          );
          validation.bpjson_ownership_disclosure_ms = response.elapsedTimeInMilliseconds;
          validation.bpjson_ownership_disclosure_errortype = response.errorType;
          validation.bpjson_ownership_disclosure_httpcode = response.httpCode;
        });
      }

      /**
       * Test 3.6: email
       */
      if (getChainsConfigItem(chainId, "guild_bpjson_email")) {
        // Valid email field in bp.json
        if (response.getDataItem(["org", "email"]) !== undefined) {
          // Check if email if formatted correctly
          const emailOk = !Array.isArray(response.getDataItem(["org", "email"])) && isEmail(response.getDataItem(["org", "email"]));
          validation.bpjson_email_ok = calculateValidationLevel(emailOk, chainId, "guild_bpjson_email_level");

          if (validation.bpjson_email_ok !== ValidationLevel.SUCCESS)
            validation.bpjson_email_message = "has an invalid format: " + response.getDataItem(["org", "email"]);

          // No email field is provided in bp.json
        } else {
          validation.bpjson_email_ok = calculateValidationLevel(false, chainId, "guild_bpjson_email_level");
          validation.bpjson_email_message = "was not provided";
        }
      }

      /**
       * Test : GitHub User
       */
      if (getChainsConfigItem(chainId, "guild_bpjson_github")) {
        if (response.getDataItem(["org", "github_user"]) !== undefined) {
          // Get github_user from json
          const gitHubUserObj = response.getDataItem(["org", "github_user"]);

          // More than one GitHub user supplied
          if (Array.isArray(gitHubUserObj)) {
            let gitHubUserIncorrectMessage = "Was provided but has invalid formatting (";
            validation.bpjson_github_user_ok = calculateValidationLevel(true, chainId, "guild_bpjson_github_level");

            // Check array length
            if (gitHubUserObj.length === 0) {
              gitHubUserIncorrectMessage += "an empty array was provided";
              validation.bpjson_github_user_ok = calculateValidationLevel(false, chainId, "guild_bpjson_github_level");
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
                gitHubUserIncorrectMessage += (validation.bpjson_github_user_ok ? "" : ", ") + gitHubUser;
                validation.bpjson_github_user_ok = calculateValidationLevel(
                  false,
                  chainId,
                  "guild_bpjson_github_level"
                );
              }
            }
            gitHubUserIncorrectMessage += ")";
            if (!validation.bpjson_github_user_ok) validation.bpjson_github_user_message = gitHubUserIncorrectMessage;
          }

          // One GitHub user supplied
          else {
            const githubUserOk =
              new RegExp(".+").test(gitHubUserObj) &&
              !new RegExp("https?://.+").test(gitHubUserObj.toLowerCase()) &&
              !new RegExp("^@").test(gitHubUserObj);
            validation.bpjson_github_user_ok = calculateValidationLevel(
              githubUserOk,
              chainId,
              "guild_bpjson_github_level"
            );

            if (!validation.bpjson_github_user_ok)
              validation.bpjson_github_user_message =
                "Was provided, but has invalid formatting (" + gitHubUserObj + ")";
          }
        } else {
          validation.bpjson_github_user_message = "Was not provided";
          validation.bpjson_github_user_ok = calculateValidationLevel(false, chainId, "guild_bpjson_github_level");
        }
      }

      /**
       * Test 3. : Chain resources
       */
      if (getChainsConfigItem(chainId, "guild_bpjson_chain_resources")) {
        if (response.getDataItem(["org", "chain_resources"]) !== undefined) {
          if (Array.isArray(response.getDataItem(["org", "chain_resources"]))) {
            validation.bpjson_chain_resources_message = "Arrays are not allowed";
            validation.bpjson_chain_resources_ok = calculateValidationLevel(
              false,
              chainId,
              "guild_bpjson_chain_resources"
            );
          } else {
            const chainResourcesOk = isURL(response.getDataItem(["org", "chain_resources"]));
            validation.bpjson_chain_resources_ok = calculateValidationLevel(
              chainResourcesOk,
              chainId,
              "guild_bpjson_chain_resources_level"
            );

            if (!validation.bpjson_chain_resources_ok) {
              validation.bpjson_chain_resources_message = "Is not a valid url";
            }
          }
        } else {
          validation.bpjson_chain_resources_message = "Were not provided";
          validation.bpjson_chain_resources_ok = calculateValidationLevel(
            false,
            chainId,
            "guild_bpjson_chain_resources_level"
          );
        }
      }

      /**
       * Test 3. : Other resources
       */
      if (getChainsConfigItem(chainId, "guild_bpjson_other_resources")) {
        validation.bpjson_other_resources_ok = calculateValidationLevel(
          true,
          chainId,
          "guild_bpjson_other_resources_level"
        );
        let otherResourcesIncorrectMessage = "";
        if (response.getDataItem(["org", "other_resources"]) !== undefined) {
          const resourcesArray = response.getDataItem(["org", "other_resources"]);
          // todo: test code
          if (Array.isArray(resourcesArray)) {
            resourcesArray.forEach((resource) => {
              if (!isURL(resource)) {
                if (!validation.bpjson_other_resources_ok) otherResourcesIncorrectMessage += ", ";

                otherResourcesIncorrectMessage += resource + " (invalid url)";
                validation.bpjson_other_resources_ok = calculateValidationLevel(
                  false,
                  chainId,
                  "guild_bpjson_other_resources_level"
                );
              }
            });
          } else {
            otherResourcesIncorrectMessage = "Is not a valid array";
            validation.bpjson_other_resources_ok = calculateValidationLevel(
              false,
              chainId,
              "guild_bpjson_other_resources_level"
            );
          }
        } else {
          otherResourcesIncorrectMessage = "Were not provided";
          validation.bpjson_other_resources_ok = calculateValidationLevel(
            false,
            chainId,
            "guild_bpjson_other_resources_level"
          );
        }
        validation.bpjson_other_resources_message =
          otherResourcesIncorrectMessage === "" ? null : otherResourcesIncorrectMessage;
      }

      /**
       * Test 3.7: branding
       */
      if (getChainsConfigItem(chainId, "guild_bpjson_branding")) {
        let brandingIncorrectMessage = "";
        // todo: check if array check is necessary
        if (
          response.getDataItem(["org", "branding"]) !== undefined &&
          Object.keys(response.getDataItem(["org", "branding"])).length >= 3
        ) {
          let successfulBrandingRequests = 0;
          // Logo 256px
          const logo256Url = response.getDataItem(["org", "branding", "logo_256"]);
          await http.get(logo256Url).then(async (response) => {
            // Successful request and logo is in right format
            if (response.ok && new RegExp("image/(png|jpg]).*").test(response.headers.get("content-type"))) {
              // Update URL to logo_256 in database
              await database.manager.update(Guild, guild.name, {
                url_logo_256: logo256Url,
              });
              successfulBrandingRequests++;
            }
            // Successful request but logo is not right format
            else if (response.ok) {
              brandingIncorrectMessage += brandingIncorrectMessage === "" ? "" : ", ";
              brandingIncorrectMessage += "logo_256 (wrong format)";
            }
            // Request was not successful
            else {
              brandingIncorrectMessage += brandingIncorrectMessage === "" ? "" : ", ";
              brandingIncorrectMessage += "logo_256 (" + response.errorMessage + ")";
            }
          });

          // Logo 1024px
          await http.get(response.getDataItem(["org", "branding", "logo_1024"])).then((response) => {
            // Successful request and logo is in right format
            if (response.ok && new RegExp("image/(png|jpg]).*").test(response.headers.get("content-type"))) {
              successfulBrandingRequests++;
            }
            // Successful request but logo is not right format
            else if (response.ok) {
              brandingIncorrectMessage += brandingIncorrectMessage === "" ? "" : ", ";
              brandingIncorrectMessage += "logo_1024 (wrong format)";
            }
            // Request was not successful
            else {
              brandingIncorrectMessage += brandingIncorrectMessage === "" ? "" : ", ";
              brandingIncorrectMessage += "logo_1024 (" + response.errorMessage + ")";
            }
          });

          // Logo svg
          await http.get(response.getDataItem(["org", "branding", "logo_svg"])).then((response) => {
            // Successful request and logo is in right format
            if (response.ok && new RegExp("image/svg.*").test(response.headers.get("content-type"))) {
              successfulBrandingRequests++;
            }
            // Successful request but logo is not right format
            else if (response.ok) {
              brandingIncorrectMessage += brandingIncorrectMessage === "" ? "" : ", ";
              brandingIncorrectMessage += "logo_svg (wrong format)";
            }
            // Request was not successful
            else {
              brandingIncorrectMessage += brandingIncorrectMessage === "" ? "" : ", ";
              brandingIncorrectMessage += "logo_svg (" + response.errorMessage + ")";
            }
          });

          // Branding is only valid if all branding checks were successful
          validation.bpjson_branding_ok = calculateValidationLevel(
            successfulBrandingRequests >= 3,
            chainId,
            "guild_bpjson_branding_level"
          );
        } else {
          validation.bpjson_branding_ok = calculateValidationLevel(false, chainId, "guild_bpjson_branding_level");
          brandingIncorrectMessage = "not provided in all three formats";
        }

        validation.bpjson_branding_message = brandingIncorrectMessage === "" ? null : brandingIncorrectMessage;
      }

      /**
       * Test 3.8: location
       */
      if (getChainsConfigItem(chainId, "guild_bpjson_location")) {
        const bpjsonLocationOk =
          response.getDataItem(["org", "location"]) !== undefined &&
          validateBpLocation(response.getDataItem(["org", "location"]));
        validation.bpjson_location_ok = calculateValidationLevel(
          bpjsonLocationOk,
          chainId,
          "guild_bpjson_location_level"
        );

        // Add Location from BP.json to Guild database to ensure proper Location if chain uses location producer-schedule
        if (bpjsonLocationOk && typeof response.getDataItem(["org", "location", "country"]) === "string") {
          await database.manager.update(Guild, guild.name, {
            locationAlpha: response.getDataItem(["org", "location", "country"]).toUpperCase()
          });
        }
      }

      /**
       * Test 3.9: social
       */
      if (getChainsConfigItem(chainId, "guild_bpjson_social")) {
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
          validation.bpjson_social_ok = calculateValidationLevel(
            validSocialReferences >= 4,
            chainId,
            "guild_bpjson_social_level"
          );
        } else {
          validation.bpjson_social_ok = calculateValidationLevel(false, chainId, "guild_bpjson_social_level");
        }
      }

      /**
       * ====================================================================================
       * NODES VALIDATION TRIGGERED FROM HERE
       * ====================================================================================
       */
      if (response.getDataItem(["nodes"]) !== undefined && Object.keys(response.getDataItem(["nodes"])).length >= 1) {
        for (const node of response.getDataItem(["nodes"])) {
          if (node["node_type"]) {
            /**
             * Test 3.11: Check if producer is listed
             */
            if (
              getChainsConfigItem(chainId, "guild_nodeProducer_found") &&
              (node.node_type == "producer" || (Array.isArray(node.node_type) && node.node_type.includes("producer")))
            ) {
              if (!validation.nodes_producer_found)
                validation.nodes_producer_found = calculateValidationLevel(
                  validateBpLocation(node.location),
                  chainId,
                  "guild_nodeProducer_found_level"
                );
            }
            if (
              getChainsConfigItem(chainId, "validate_nodeSeed") &&
              (node.node_type == "seed" || (Array.isArray(node.node_type) && node.node_type.includes("seed")))
            ) {
              /**
               * Test 3.12: Test Seed Nodes
               */
              const seedNode: NodeSeed = await seed.validateSeed(guild, chainId, node.p2p_endpoint, node.location);

              // Add seed validation to validation object, if it is not undefined (e.g. undefined if no url was provided)
              if (seedNode) {
                if (!validation.nodes_seed) {
                  validation.nodes_seed = [];
                }
                validation.nodes_seed.push(seedNode);
              }
            }
            if (
              (node.node_type == "query" || (Array.isArray(node.node_type) && node.node_type.includes("query"))) &&
              Array.isArray(node.features)
            ) {
              // todo: handle feature check properly
              if (getChainsConfigItem(chainId, "validate_nodeApi") && node.features.includes("chain-api")) {
                /**
                 * Test 3.13: Test Api Nodes
                 */
                // Validate API
                const nodeApi: NodeApi = await api.validateApi(guild, chainId, node.api_endpoint, false, node.location);
                if (nodeApi) {
                  if (!validation.nodes_api) {
                    validation.nodes_api = [];
                  }
                  validation.nodes_api.push(nodeApi);
                }

                // Validate API SSL
                const nodeApiSSL: NodeApi = await api.validateApi(guild, chainId, node.ssl_endpoint, true, node.location);
                if (nodeApiSSL) {
                  if (!validation.nodes_api) {
                    validation.nodes_api = [];
                  }
                  validation.nodes_api.push(nodeApiSSL);
                }
              }

              if (getChainsConfigItem(chainId, "validate_nodeWallet") && node.features.includes("account-query")) {
                /**
                 * Test 3.13: Test Api Nodes
                 */
                // Validate Wallet
                const nodeWallet: NodeWallet = await wallet.validateWallet(
                  guild,
                  chainId,
                  node.api_endpoint,
                  false,
                    node.location
                );
                if (nodeWallet) {
                  if (!validation.nodes_wallet) {
                    validation.nodes_wallet = [];
                  }
                  validation.nodes_wallet.push(nodeWallet);
                }

                // Validate Wallet SSL
                const nodeWalletSSL: NodeWallet = await wallet.validateWallet(
                  guild,
                  chainId,
                  node.ssl_endpoint,
                  true,
                  node.location
                );
                if (nodeWalletSSL) {
                  if (!validation.nodes_wallet) {
                    validation.nodes_wallet = [];
                  }
                  validation.nodes_wallet.push(nodeWalletSSL);
                }
              }

              if (getChainsConfigItem(chainId, "validate_NodeHistory") && node.features.includes("history-v1")) {

                // Validate History
                const nodeHistory: NodeHistory = await history.validateHistory(
                  guild,
                  chainId,
                  node.api_endpoint,
                  false,
                  node.location
                );
                if (nodeHistory) {
                  if (!validation.nodes_history) {
                    validation.nodes_history = [];
                  }
                  validation.nodes_history.push(nodeHistory);
                }

                // Validate History SSL
                const nodeHistorySSL: NodeHistory = await history.validateHistory(
                  guild,
                  chainId,
                  node.ssl_endpoint,
                  true,
                  node.location
                );
                if (nodeHistorySSL) {
                  if (!validation.nodes_history) {
                    validation.nodes_history = [];
                  }
                  validation.nodes_history.push(nodeHistorySSL);
                }
              }

              if (getChainsConfigItem(chainId, "validate_NodeHyperion") && node.features.includes("hyperion-v2")) {
                // Validate Hyperion
                const nodeHyperion: NodeHyperion = await hyperion.validateHyperion(
                  guild,
                  chainId,
                  node.api_endpoint,
                  false,
                  node.location
                );
                if (nodeHyperion) {
                  if (!validation.nodes_hyperion) {
                    validation.nodes_hyperion = [];
                  }
                  validation.nodes_hyperion.push(nodeHyperion);
                }

                // Validate Hyperion SSL
                const nodeHyperionSSL: NodeHyperion = await hyperion.validateHyperion(
                  guild,
                  chainId,
                  node.ssl_endpoint,
                  true,
                  node.location
                );
                if (nodeHyperionSSL) {
                  if (!validation.nodes_hyperion) {
                    validation.nodes_hyperion = [];
                  }
                  validation.nodes_hyperion.push(nodeHyperionSSL);
                }
              }

              if (getChainsConfigItem(chainId, "validate_nodeAtomic") && node.features.includes("atomic-assets-api")) {

                // Validate Atomic
                const nodeAtomic: NodeAtomic = await atomic.validateAtomic(
                  guild,
                  chainId,
                  node.api_endpoint,
                  false,
                  node.location
                );
                if (nodeAtomic) {
                  if (!validation.nodes_atomic) {
                    validation.nodes_atomic = [];
                  }
                  validation.nodes_atomic.push(nodeAtomic);
                }

                // Validate Atomic SSL
                const nodeAtomicSSL: NodeAtomic = await atomic.validateAtomic(
                  guild,
                  chainId,
                  node.ssl_endpoint,
                  true,
                  node.location
                );
                if (nodeAtomicSSL) {
                  if (!validation.nodes_atomic) {
                    validation.nodes_atomic = [];
                  }
                  validation.nodes_atomic.push(nodeAtomicSSL);
                }
              }
            }
          }
        }
      }
    });
  } else {
    validation.bpjson_ok = calculateValidationLevel(false, chainId, "guild_bpjson_level");
  }

  /**
   * All checks ok
   */
  const validations: [string, ValidationLevel][] = [
    ["guild_location", validation.reg_location_ok],
    ["guild_reg_website", validation.reg_website_ok],
    ["guild_chains_json", validation.chains_json_ok],
    ["guild_chains_json_access_control_header", validation.chains_json_access_control_header_ok],
    ["guild_bpjson", validation.bpjson_ok],
    ["guild_bpjson_producer_name", validation.bpjson_producer_account_name_ok],
    ["guild_bpjson_candidate_name", validation.bpjson_candidate_name_ok],
    ["guild_bpjson_website", validation.bpjson_website_ok],
    ["guild_bpjson_code_of_conduct", validation.bpjson_code_of_conduct_ok],
    ["guild_bpjson_ownership_disclosure", validation.bpjson_ownership_disclosure_ok],
    ["guild_bpjson_email", validation.bpjson_email_ok],
    ["guild_bpjson_github", validation.bpjson_github_user_ok],
    ["guild_bpjson_chain_resources", validation.bpjson_chain_resources_ok],
    ["guild_bpjson_other_resources", validation.bpjson_other_resources_ok],
    ["guild_bpjson_branding", validation.bpjson_branding_ok],
    ["guild_bpjson_location", validation.bpjson_location_ok],
    ["guild_bpjson_social", validation.bpjson_social_ok],
    ["guild_bpjson_matches_onchain", validation.bpjson_matches_onchain],
    ["guild_nodeProducer_found", validation.nodes_producer_found],
  ];

  validation.all_checks_ok = allChecksOK(validations, chainId);

  /**
   * SAVE results to database
   */

  // Store Validation object to Database
  await database.manager.save(validation);
  childLogger.debug(
    "SAVED \t New validation validation for " + guild.name + " " + getChainsConfigItem(chainId, "name") + " to database"
  );

  // It must be returned a dummy promise, so the parent function calling this function waits until all validations are completed
  return Promise.resolve(true);
}