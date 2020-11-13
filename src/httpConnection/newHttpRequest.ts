import * as fetch from "node-fetch";
import * as config from "config";
import { NewHttpResponse } from "./newHttpResponse";
import { sleep } from "eosio-protocol";
import { HttpErrorType } from "./HttpErrorType";
import { logger } from "../common";

export async function request(
  base: string,
  path = "",
  payloadAsJson: string = undefined,
  retryCounter: number = config.get("validation.request_retry_count"),
  contentType = "application/json"
): Promise<NewHttpResponse> {
  const response = new NewHttpResponse();

  // Check if base url was provided
  if (!base || base === "") {
    response.setErrorMessage("No url was provided");
    response.errorType = HttpErrorType.OTHER;
    return response;
  }

  // Combine base and path to url
  // todo: (optional) check for generic domainnames: google.de etc.
  let urlWithPath: URL;
  try {
    urlWithPath = new URL(path, base);
  } catch (e) {
    response.setErrorMessage("Invalid url formatting");
    response.errorType = HttpErrorType.OTHER;
    return response;
  }

  // Send Request
  if (!payloadAsJson) {
    const startTime = Date.now();
    await timeout(
      fetch(urlWithPath, {
        method: "GET",
      })
    )
      .then(async (fetchResponse) => {
        await response.parseFetchResponse(fetchResponse, startTime);
      })
      .catch((e) => {
        response.parseFetchError(e);
      });
  } else {
    // todo: decide if really necessary
    // todo: check if content type match is necessary
    try {
      JSON.parse(payloadAsJson);
    } catch (e) {
      response.setErrorMessage("Payload for post request is not valid JSON");
      return response;
    }
  const startTime = Date.now();
    await timeout(
      fetch(urlWithPath, {
        method: "POST",
        headers: {
          "content-type": contentType,
        },
        data: payloadAsJson,
      })
    )
      .then(async (fetchResponse) => {
        await response.parseFetchResponse(fetchResponse, startTime);
      })
      .catch((e) => {
        response.parseFetchError(e);
      });
  }

  // Return request if successful
  if (response.ok || retryCounter <= 0) {
    return response;
  }
  // Retry request if not successful
  else {
    logger.debug(urlWithPath + " => Retrying request (" + retryCounter + ")")

    // Sleep in order to avoid potential problems with rate limits
    await sleep(config.get("validation.request_retry_pause_ms"));

    // Try again
    return request(base, path, payloadAsJson, --retryCounter, contentType);
  }
}

/**
 * Throws an error if promise is not resolved within the specified amount of timeoutMs
 * @param promise = promise to be resolved (e.g. fetch request)
 * @return {Promise<unknown>}
 */
function timeout(promise): Promise<Response> {
  const timeoutMs = config.get("validation.request_timeout_ms");
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("timeout"));
    }, timeoutMs);
    promise.then(
      (res) => {
        clearTimeout(timeoutId);
        resolve(res);
      },
      (err) => {
        clearTimeout(timeoutId);
        reject(err);
      }
    );
  });
}
