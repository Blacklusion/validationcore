import { logger } from "./common";
import * as fs from "fs";
import * as config from "config";

/**
 * Determines if there as been a change between the current Validation and the previous Validation.
 * The Message string will be concatenated based on newValidation
 * @param {boolean} oldValidation = the state of the previous validation -> If true, the last validation was successful
 * @param {boolean} newValidation = the state of the current validation -> If true, the current validation was successful
 * @param {string} message = The beginning of the message, based on the evaluation of newValidation, either correctMessage (newValidation = true)
 *                           or IncorrectMessage (newValidation = false) will be concatenated to the end
 * @param {string} correctMessage = the message concatenated if newValidation is true and therefore the validation was successful
 * @param {string} incorrectMessage = the message concatenated if newValidation is false and therefore the validation was not successful
 * @return {[string, number]} = the formatted message and a number indicating the messageState (enum)
 */
export function evaluateMessage(
  oldValidation: boolean,
  newValidation: boolean,
  message: string,
  correctMessage: string,
  incorrectMessage: string
): [string, number] {
  // Check if new Validation was not assigned before calling method -> This would indicate a malfunctioning validation
  if (newValidation == null) {
    logger.warn(
      "NewValidation is null. This should not be the case. Check code. Message: (" +
        message +
        " " +
        correctMessage +
        " / " +
        incorrectMessage +
        ")"
    );
  }

  /**
   * Evaluate the MessageState
   * Determine if there has been a change from the new validation to the old validation and in which direction ((true to false) or (false to true))
   */
  let state: messageState;
  if (oldValidation) {
    // Old and new Validation are BOTH true -> Unchanged
    if (newValidation) {
      state = messageState.fromTrueToTrue;
    }
    // Old Validation was true and new Validation is false or undefined -> Changed
    else {
      state = messageState.fromTrueToFalse;
    }
  } else {
    // Old and new Validation are BOTH false or undefined -> Unchanged
    if (newValidation) {
      state = messageState.fromFalseToTrue;
    }
    // Old Validation was false or undefined and new Validation is true -> Changed
    else {
      state = messageState.fromFalseToFalse;
    }
  }

  return [
    message +
      (message && message.length > 0 ? " " : "") +
      (state === messageState.fromTrueToTrue || state === messageState.fromFalseToTrue
        ? correctMessage
        : incorrectMessage),
    state,
  ];
}

/**
 * Converts array of messages to json
 * @param {[string, any][]} array = array containing all the validationMessages and the according messageState stored as a number
 * @param {string} endpoint = optional -> if provided an Endpoint Field will be provided at the top of the json
 * @return {any} = values of array formatted as json
 */
export function convertArrayToJson(array: [string, any][], endpoint: string = undefined): any {
  const json = {};

  // Add Endpoint at top if provided
  if (endpoint !== undefined) json["endpoint"] = endpoint;

  // Add all messages as provided in the array to json
  array.forEach((value) => {
    json[value[0]] = value[1];
  });

  return json;
}
/**
 * Writes a jsonFormatted file to disk
 * @param {string} guild = guild Name
 * @param {string} isMainnet = indicates if the json is for mainnet or testnet. Only used for creating a unique filename
 * @param {string} content = json Formatted content of the file
 */
export async function writeJsonToDisk(guild: string, isMainnet: boolean, content: string): Promise<void> {
  // Create filename with path
  const fileName = config.get("general.json_directory") + guild + "_" + (isMainnet ? "main" : "test") + ".json";

  // Write file to disk
  try {
    await fs.writeFileSync(fileName, content);
  } catch (error) {
    logger.error("Error while saving " + fileName, error);
  }
}

/**
 * Properly storing the message state is important, because the goal is to store all messages as json (regardless if true or false)
 * But at the same time the user will only be informed about messages that have changed (therefore no messages will be sent for TrueToTrue and FalseToFalse)
 */
export enum messageState {
  fromTrueToTrue,
  fromTrueToFalse,
  fromFalseToTrue,
  fromFalseToFalse,
}

function createApiMessages() {
  validationMessages.push(evaluateMessage(lastValidation.ssl_ok, api.ssl_ok, "TLS", "ok", sslMessage));

  validationMessages.push(
    evaluateMessage(
      lastValidation.get_info_ok,
      api.get_info_ok,
      "Get_info request",
      "successful",
      "not successful" + response.getFormattedErrorMessage()
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.server_version_ok,
      api.server_version_ok,
      "Server version " + serverVersion + " is",
      "valid",
      "invalid"
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.correct_chain,
      api.correct_chain,
      "Api is provided for the",
      "correct chain",
      "wrong chain"
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.head_block_delta_ok,
      api.head_block_delta_ok,
      "Head block",
      "is up-to-date",
      "is not up-to-date" + headBlockIncorrectMessage
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.block_one_ok,
      api.block_one_ok,
      "Block one test",
      "passed",
      "not passed" + response.getFormattedErrorMessage()
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.verbose_error_ok,
      api.verbose_error_ok,
      "Verbose Error test",
      "passed",
      "not passed" + response.getFormattedErrorMessage()
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.abi_serializer_ok,
      api.abi_serializer_ok,
      "Abi serializer test",
      "passed",
      "not passed" + response.getFormattedErrorMessage()
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.basic_symbol_ok,
      api.basic_symbol_ok,
      "Basic symbol test",
      "passed",
      "not passed" + response.getFormattedErrorMessage()
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.producer_api_off,
      api.producer_api_off,
      "Producer api",
      "is disabled",
      producerApiIncorrectMessage
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.db_size_api_off,
      api.db_size_api_off,
      "Db_size api",
      "is disabled",
      dbSizeIncorrectMessage
    )
  );

  validationMessages.push(
    evaluateMessage(lastValidation.net_api_off, api.net_api_off, "Net api", "is disabled", netApiIncorrectMessage)
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.wallet_accounts_ok,
      api.wallet_accounts_ok,
      "Wallet get_accounts_by_authorizers by accounts test",
      "passed",
      "not passed" + response.getFormattedErrorMessage()
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.wallet_keys_ok,
      api.wallet_keys_ok,
      "Wallet get_accounts_by_authorizers by keys test",
      "passed",
      "not passed" + response.getFormattedErrorMessage()
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.bp_json_all_features_ok,
      api.bp_json_all_features_ok,
      "Supplied features in bp.json are",
      "ok",
      featuresIncorrectMessage
    )
  );

  validationMessages.push(
    evaluateMessage(lastValidation.all_checks_ok, api.all_checks_ok, "Chain Api", "healthy", "not healthy")
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.wallet_all_checks_ok,
      api.wallet_all_checks_ok,
      "Account Query Api is",
      "healthy",
      "not healthy"
    )
  );
}

function createHistoryMessages() {
  validationMessages.push(evaluateMessage(lastValidation.ssl_ok, history.ssl_ok, "TLS", "ok", sslMessage));

  validationMessages.push(
    evaluateMessage(
      lastValidation.history_transaction_ok,
      history.history_transaction_ok,
      "History get_transaction test",
      "passed",
      "not passed" + response.getFormattedErrorMessage()
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.history_actions_ok,
      history.history_actions_ok,
      "History get_actions test",
      "passed",
      "not passed" + historyActionsIncorrectMessage
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.history_key_accounts_ok,
      history.history_key_accounts_ok,
      "History get_key_accounts test",
      "passed",
      "not passed" + historyKeyIncorrectMessage
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.hyperion_health_found,
      history.hyperion_health_found,
      "Hyperion /v2/health",
      "found",
      "not found" + response.getFormattedErrorMessage()
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.hyperion_health_version_ok,
      history.hyperion_health_version_ok,
      "Hyperion version",
      "provided in /v2/health",
      "not provided in /v2/health"
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.hyperion_health_host_ok,
      history.hyperion_health_host_ok,
      "Hyperion host",
      "provided in /v2/health",
      "not provided in /v2/health"
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.hyperion_health_query_time_ok,
      history.hyperion_health_query_time_ok,
      "Hyperion query time",
      "ok",
      queryTimeIncorrectMessage
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.hyperion_health_all_features_ok,
      history.hyperion_health_all_features_ok,
      "Hyperion features",
      "ok",
      "not ok" + featureIncorrectMessage
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.hyperion_health_nodeosrpc_ok,
      history.hyperion_health_nodeosrpc_ok,
      "Hyperion NodesRpc status",
      "ok",
      nodeosRpcIncorrectMessage
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.hyperion_health_rabbitmq_ok,
      history.hyperion_health_rabbitmq_ok,
      "Hyperion RabbitMq status",
      "ok",
      "not ok"
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.hyperion_health_elastic_ok,
      history.hyperion_health_elastic_ok,
      "Hyperion Elastic status",
      "ok",
      "not ok"
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.hyperion_health_total_indexed_blocks_ok,
      history.hyperion_health_total_indexed_blocks_ok,
      "Hyperion",
      "total indexed block == last indexed block",
      indexBlocksIncorrectMessage
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.hyperion_transaction_ok,
      history.hyperion_transaction_ok,
      "Hyperion get_transaction test",
      "passed",
      "not passed" + response.getFormattedErrorMessage()
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.hyperion_actions_ok,
      history.hyperion_actions_ok,
      "Hyperion get_actions test",
      "passed",
      "not passed" + hyperionActionsIncorrectMessage
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.hyperion_key_accounts_ok,
      history.hyperion_key_accounts_ok,
      "Hyperion get_key_accounts test",
      "passed",
      "not passed" + response.getFormattedErrorMessage()
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.history_all_checks_ok,
      history.history_all_checks_ok,
      "History /v1/history is",
      "healthy",
      "not healthy"
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.hyperion_all_checks_ok,
      history.hyperion_all_checks_ok,
      "Hyperion /v2/history is",
      "healthy",
      "not healthy"
    )
  );
}

function createSeedMessage() {
  validationMessages.push(
    evaluateMessage(
      lastValidation.p2p_endpoint_address_ok,
      seed.p2p_endpoint_address_ok,
      "Provided P2P address",
      "valid",
      "invalid"
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.block_transmission_speed_ok,
      seed.block_transmission_speed_ok,
      "Block transmission speed is",
      "OK",
      "too slow"
    )
  );

  validationMessages.push(
    evaluateMessage(
      lastValidation.p2p_connection_possible,
      seed.p2p_connection_possible,
      "P2P connection was",
      "possible",
      "not possible" + message
    )
  );

  validationMessages.push(
    evaluateMessage(lastValidation.all_checks_ok, seed.all_checks_ok, "Seed Node is", "healthy", "not healthy")
  );
}
