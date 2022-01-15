import * as fetch from "node-fetch";
import * as config from "config";
import { HttpResponse } from "./HttpResponse";
import { HttpErrorType } from "../validationcore-database-scheme/enum/HttpErrorType";
import { getChainsConfigItem, validationConfig } from "../validationcore-database-scheme/readConfig";
import { logger, sleep } from "../validationcore-database-scheme/common";

/**
 * GET Request
 * @param {string} base = base url of request without any additional path
 * @param {string} path = additional path of request, can be undefined
 * @param {number} failedRequests = how many previous validations of the same node failed before
 */
export async function get(
  base: string,
  path = "",
  failedRequests = 0,
): Promise<HttpResponse> {
  return await httpRequest(base, path, evaluatePerformanceMode(failedRequests, base), true, undefined, undefined);
}

/**
 * POST Request
 * @param {string} base = base url of request without any additional path
 * @param {string} path = additional path of request, can be undefined
 * @param {json} payloadAsJson = payload as valid json
 * @param {number} failedRequests = how many previous validations of the same node failed before
 * @param {string} contentType = can be used to specify the contentType of Request. Defaults to json
 */
export async function post(
  base: string,
  path = "",
  payloadAsJson: any = {},
  failedRequests = 0,
  contentType = "application/json"
): Promise<HttpResponse> {
  return await httpRequest(base, path, evaluatePerformanceMode(failedRequests, base), false, payloadAsJson, contentType);
}

/**
 * Allows to make requests based on the schema supplied in ./config/validation-config
 * @param {string} endpointUrl = url of the API endpoint
 * @param {string} validationKey = name of the test as specified in the config
 * @param {string} chainId = ChainId of the validation
 * @param {string} failedRequests = how many previous validations of the same node failed before
 */
export async function request(
  endpointUrl: string,
  validationKey: string,
  chainId: string,
  failedRequests = 0
): Promise<HttpResponse> {
  let path = validationConfig[validationKey].path;
  let payload = validationConfig[validationKey].payload;
  try {
    if (validationConfig[validationKey].variables !== null) {
      validationConfig[validationKey].variables.forEach((x) => {
        if (path) path = path.replace(x, getChainsConfigItem(chainId, x));
        if (payload) payload = payload.replace(x, getChainsConfigItem(chainId, x));
      });
    }
    payload = JSON.parse(payload);
  } catch (e) {
    logger.fatal(
      "Error during reading path and payload from config. Likely an error in ./config/chains.csv or ./config/validation-config/*.json \nPath: " +
        path +
        "\nPayload: " +
        payload +
        e
    );
  }

  if (validationConfig[validationKey].requestMethod.toLowerCase() === "get") {
    return await get(endpointUrl, path, failedRequests);
  } else if (validationConfig[validationKey].requestMethod.toLowerCase() === "post") {
    return await post(endpointUrl, path, payload, failedRequests);
  } else {
    logger.fatal("Invalid RequestMethod for " + validationKey + ". Check ./config/validation-config");
  }
}

/**
 * Validates if a url has SSL configured properly
 * @param {string} url = Url that will be validated
 * @param {boolean} responseOk = if the request this is called from was successful
 * @param {HttpErrorType} errorType = the errorType of the request this was called from
 * @return {[boolean, string]} = the first argument is true if the check succeeded, the second contains the error message
 */
export async function evaluateSSL(url: string, responseOk: boolean, errorType: HttpErrorType): Promise<HttpResponse> {
  const sslResponse = new HttpResponse();
  if (!new RegExp("https://.+").test(url)) {
    sslResponse.ok = false;
    sslResponse.errorType = HttpErrorType.INVALIDURL;
    sslResponse.errorMessage = "no https url provided";
  } else {
    sslResponse.errorType = errorType;
    sslResponse.ok = responseOk || (!responseOk && errorType === HttpErrorType.HTTP);
  }

  return sslResponse;
}

/**
 * Can be used to perform both get and post request. However, the use of the specific wrapperMethods are recommended
 * @param {string} base = base url of request without any additional path
 * @param {string} path = additional path of request, can be undefined
 * @param {number} retryCounter = How often the request will be repeated if it fails. 0 means that the request wil be performed exactly once. Defaults to retryNumber specified in config
 * @param {boolean} isGetRequest = If true a get Request will be performed, if false a post request will be performed
 * @param {json} payloadAsJson = payload as valid json
 * @param {string} contentType = can be used to specify the contentType of Request. Defaults to json
 */
async function httpRequest(
  base: string,
  path = "",
  retryCounter: number = config.get("validation.request_retry_count"),
  isGetRequest: boolean,
  payloadAsJson: any = {},
  contentType = "application/json"
): Promise<HttpResponse> {
  const response = new HttpResponse();
  // Check if base url was provided
  if (!base || base === "") {
    response.setErrorMessage("No url was provided");
    response.errorType = HttpErrorType.INVALIDURL;
    return response;
  }

  // Combine base and path to url
  let urlWithPath: URL;
  try {
    // Extract original path (needs to be done, since new URL(path, base) would overwrite the original path)
    const originalPath = new URL(base).pathname;

    if (originalPath.length >= 1 && path.length >= 1) {
      const combinedPath =
        originalPath +
        (originalPath.charAt(originalPath.length - 1) === "/" ? "" : "/") +
        (path.charAt(0) === "/" ? path.substring(1, path.length) : path);
      urlWithPath = new URL(combinedPath, base);
    } else {
      urlWithPath = new URL(path, base);
    }
  } catch (e) {
    response.setErrorMessage("Invalid url formatting");
    response.errorType = HttpErrorType.INVALIDURL;
    return response;
  }

  // Sleep before requests ensures that there will always be a delay between multiple requests
  await sleep(config.get("validation.request_delay"));

  // Send Request
  if (isGetRequest) {
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
    const startTime = Date.now();
    await timeout(
      fetch(urlWithPath, {
        method: "POST",
        headers: {
          "content-type": contentType,
        },
        body: JSON.stringify(payloadAsJson),
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
    logger.silly(urlWithPath + " => Retrying request (" + retryCounter + ")");

    // Sleep in order to avoid potential problems with rate limits
    await sleep(config.get("validation.request_retry_delay"));

    // Try again
    return httpRequest(base, path, --retryCounter, isGetRequest, payloadAsJson, contentType);
  }
}

/**
 * Throws an error if promise is not resolved within the specified amount of timeoutMs
 * @param {Promise} promise = promise to be resolved (e.g. fetch request)
 * @return {Promise<Response>} = The outcome of the input request
 */
function timeout(promise: Promise<any>): Promise<Response> {
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

/**
 * Checks if the performance mode threshold is reached as specified in config/local.toml
 * If performance mode kicks in, requests won't be retried, hence reducing executing time and preventing hitting rate limits
 * @param {number} failedRequests = Number of prior failed requests
 * @param {string} base = request urlBase, only used for better logging
 * @return {number} = returns 0 if performance mode kicks in
 */
function evaluatePerformanceMode(failedRequests: number, base: string): number {
  if (
    config.get("validation.performance_mode") &&
    failedRequests >= Math.max(0, config.get("validation.performance_mode_threshold"))
  ) {
    logger.silly("Performance mode kicked in, " + base);
    return 0;
  } else {
    return config.get("validation.request_retry_count");
  }
}
