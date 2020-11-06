import * as axios from "axios";
import { HttpResponse } from "./HttpResponse";
import { HttpError } from "./HttpError";
import { HttpErrorType } from "./HttpErrorType";
import { logger } from "../common";
import { sleep } from "eosio-protocol";
import * as config from "config";

/**
 * GET request
 * @param url = http url
 * @param path = api request path
 * @param retryCounter = how often should the request be repeated in case it fails
 */
export async function get(
  url: string,
  path = "",
  retryCounter: number = config.get("validation.request_retry_count")
): Promise<HttpResponse> {
  // todo: implement no url provided and invalid url error
  if (!url) {
    throw new HttpError(1, 0, "No url was provided");
  }
  url = new URL(path, url).toString();

  try {
    const response: axios.AxiosResponse = await axios.default({
      method: "get",
      url: url,
      headers: { "request-startTime": Date.now() },
      timeout: config.get("validation.request_timeout_ms"),
    });
    const httpResponse: HttpResponse = new HttpResponse(response);
    return new Promise((resolve, reject) => {
      resolve(httpResponse);
    });

    // An error will be thrown for every non-OK Code (e.g. 404)
    // Catch error and throw new Error in standardized Format
  } catch (error) {
    const httpError = await categorizeError(error);
    if (httpError.type == HttpErrorType.TIMEOUT) retryCounter = Math.min(1, retryCounter);

    // Retry x times when request fails
    if (retryCounter > 0) {
      console.log(url);
      console.log(error.message);
      await sleep(config.get("validation.request_retry_pause_ms"));
      return await get(url, "", --retryCounter);
    }

    throw httpError;
  }
}

/**
 * POST request
 * @param url = http url
 * @param path = path with or without tracing dash ('/')
 * @param contentType = specify contentType of request, set to json as default, since most of the performed post requests rely on json
 * @param payloadAsJson = payload of the post request in json format
 */
export async function post(
  url: string,
  path = "",
  payloadAsJson: string,
  retryCounter: number = config.get("validation.request_retry_count"),
  contentType = "application/json"
): Promise<HttpResponse> {
  // todo: implement no url provided and invalid url error
  if (!url) {
    throw new HttpError(1, 0, "No url was provided");
  }
  url = new URL(path, url).toString();

  try {
    const response: axios.AxiosResponse = await axios.default({
      method: "post",
      url: url,
      data: payloadAsJson,
      headers: { "request-startTime": Date.now(), "Content-Type": contentType },
      timeout: config.get("validation.request_timeout_ms"),
    });
    const httpResponse: HttpResponse = new HttpResponse(response);

    return new Promise((resolve, reject) => {
      resolve(httpResponse);
    });
    // Catch error and throw new Error in standardized Format
  } catch (error) {
    const httpError = await categorizeError(error);
    if (httpError.type == HttpErrorType.TIMEOUT) retryCounter = Math.min(1, retryCounter);

    //
    if (retryCounter > 0) {
      console.log(url);
      console.log(error.message);
      await sleep(config.get("validation.request_retry_pause_ms"));
      return await post(url, "", payloadAsJson, --retryCounter, contentType);
    } else {
      throw httpError;
    }
  }
}

/**
 * Parse errors into standardized format for easier differentiation in higher functions
 * Function will contact private administrator over private telegram service if error can not be classified
 * Telegram service specified in config file
 * @param error = that shall be classified
 */
function categorizeError(error: any): HttpError {
  try {
    /**
     * SSL-Certificate (Regex matching with "CERT", since multiple values are possible e.g. "ERR_TLS_CERT_ALTNAME_INVALID" "CERT_HAS_EXPIRED"
     */
    if (error.code && new RegExp(".*CERT.*").test(error.code)) {
      return new HttpError(
        HttpErrorType.SSL,
        -1,
        "Invalid SSL certificate" + (error.message ? " (" + error.message + ")" : "")
      );
    } else if (
      /**
       * HTTP Response returned Error-Code (e.g. 404 Not Found)
       */
      error.response &&
      typeof error.response.status == "number" &&
      typeof error.response.statusText == "string"
    ) {
      return new HttpError(
        HttpErrorType.HTTP,
        error.response.status,
        error.response.status + " " + error.response.statusText,
        error.response
      );
    } else if (error.code && (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED")) {
      /**
       * DNS / Invalid DomainName
       */
      return new HttpError(HttpErrorType.DNS, -1, "Invalid url/domain");
    } else if (error.code && (error.code === "ETIMEDOUT" || error.code == "ECONNABORTED")) {
      /**
       * Timeout
       */
      return new HttpError(HttpErrorType.TIMEOUT, -1, "Timeout during request");
    }

    // Default: All other errors will not be differentiated
    // todo: contact private telegram server
  } catch (error) {
    logger.fatal("Error during http Error handling: ", error);
  }

  logger.error(
    "An uncategorized Error appeared. This does not impact the reliability of the validator. However for best user experience we recommend, adding the following error to the categorization: " +
      error.message
  );
  console.log(error);

  return new HttpError(HttpErrorType.UNKNOWN, -1, "Error during request" + (error.code ? ": " + error.code : ""));
}
