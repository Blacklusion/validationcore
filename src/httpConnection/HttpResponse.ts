import { HttpErrorType } from "../validationcore-database-scheme/enum/HttpErrorType";
import { logger } from "../validationcore-database-scheme/common";
import * as config from "config";

/**
 * Response returned by the http methods in HttpRequest
 */
export class HttpResponse {
  // Header of HttpResponse
  headers: Headers;

  // Data/Body of HttpResponse stored as normal "string"
  data: string;

  // Data/Body of HttpResponse stored as Json Object
  dataJson: any;

  // ElapsedTime between the request was send and the response was received
  private _elapsedTimeInMilliseconds: number;

  // If set to true, the request was successful (based on the returned httpCode)
  ok: boolean;

  // Returned httpCode returned by the server
  private _httpCode: number;

  // Stores the error message of a potential error during the request, including invalid domain errors etc.
  errorMessage: string;

  private _errorType: HttpErrorType;

  /**
   * Constructor
   */
  constructor() {
    this.headers = undefined;
    this.data = undefined;

    // Set to -1 to prevent checks on undefined
    this._httpCode = -1;
    this._elapsedTimeInMilliseconds = -1;
    this.ok = false;
    this.errorMessage = "";
    this._errorType = HttpErrorType.UNKNOWN;
  }

  /**
   * Parses contents of Fetch response to custom HttpResponse
   * @param {Response} response = response as returned by a fetch request
   * @param {number} startTime = time when the request was started, used for measuring the elapsedTime between request and response
   */
  async parseFetchResponse(response: Response, startTime: number): Promise<void> {
    this.ok = response.ok;
    this._httpCode = response.status;
    this.headers = response.headers;
    this.data = await response.text();

    // Check if Request was successful
    if (!this.ok) {
      this.errorMessage = this._httpCode + " " + response.statusText;
      this._errorType = HttpErrorType.HTTP;
    }

    // Calculate ElapsedTime
    if (startTime !== undefined) {
      const elapsedTimeInMilliseconds = Date.now() - startTime;

      // Prevent to big int numbers in database
      if (elapsedTimeInMilliseconds > (config.get("validation.request_timeout_ms") + 200)) {
        logger.warn("Request took longer than expected (" + elapsedTimeInMilliseconds + "ms). This is longer than the timeout (" + config.get("validation.request_timeout_ms") + "ms)")
      }
      this._elapsedTimeInMilliseconds = Math.min(elapsedTimeInMilliseconds, config.get("validation.request_timeout_ms"));
    }

    // Parse body to json if possible
    // todo: do over response.json() ?
    try {
      this.dataJson = JSON.parse(this.data);
    } catch (e) {
      this.dataJson = undefined;
    }

    if (!this.ok) {
      logger.silly(response.url + " => Request not successful: " + this.errorMessage);
    } else {
      logger.silly(response.url + " => Request successful");
    }
  }

  /**
   * Categorizes an Error that has originated during a Fetch request
   * @param {any} error = Error that has occurred during request. Http Errors (e.g. 404) will not trigger an error when using fetch, therefore this method should only be used for
   *                        categorizing other errors, such as timeout or dns errors.
   */
  parseFetchError(error: any): void {
    // Error is Timeout Error
    if (error.message === "timeout" || (error.code && (error.code === "ETIMEDOUT" || error.code == "ECONNABORTED"))) {
      this.errorMessage = "Timeout during request";
      this._errorType = HttpErrorType.TIMEOUT;
    }

    // Error is DNS Error
    else if (error.code && error.code === "ENOTFOUND") {
      this.errorMessage = "Domain not found";
      this._errorType = HttpErrorType.DNS;
    }

    // Error is SSL error
    else if (error.code !== undefined && new RegExp(".*CERT.*").test(error.code)) {
      this.errorMessage =
        "Invalid SSL certificate" +
        (error.message && error.message.includes(", reason:")
          ? " (" + error.message.substring(error.message.indexOf(", reason:") + 10, error.message.length - 1) + ")"
          : "");
      this._errorType = HttpErrorType.SSL;
    }

    // The differentiation between other errors is not really necessary
    else if (error.code !== undefined || error.type !== undefined) {
      this.errorMessage = error.code;
      // EPROTO Error will fall in this category
      if (error.code !== "ECONNREFUSED" && error.code !== "EPROTO" && error.code !== "ECONNRESET" && error.type !== "max-redirect") {
        logger.warn(
          "An undefined error occured: " + error.code + ". Consider adding additional handling for this errorType."
        );
        console.log(error.code);
      }
      this._errorType = HttpErrorType.OTHER;
    }

    // The error is not a FetchError -> This should not be the case
    else {
      this.errorMessage = "Unknown Error";
      logger.warn("An unknown error was tried to be parsed during a httpRequest. This should not be the case: ", error);
      this._errorType = HttpErrorType.UNKNOWN;
    }

    logger.debug("ERROR: Request not successful: " + this.errorMessage);
  }

  /**
   * Checks if body can be parsed into a valid JSON
   * @return {boolean} = is true if response as valid json as body
   */
  isJson(): boolean {
    return this.dataJson !== undefined;
  }

  /**
   * Overwrites Error Message of Response
   * @param {string} message = new Error message
   * @return {void}
   */
  setErrorMessage(message: string): void {
    this.errorMessage = message;
  }

  /**
   * Return null instead of -1, since -1 is the default set in the constructor
   */
  get httpCode(): number {
    return this._httpCode === -1 ? null : this._httpCode;
  }

  /**
   * Getter errorType
   */
  get errorType(): HttpErrorType {
    return this._errorType;
  }

  /**
   * Setter method for ErrorType
   * @param {HttpErrorType} value
   */
  set errorType(value: HttpErrorType) {
    this._errorType = value;
  }

  /**
   *
   */
  get elapsedTimeInMilliseconds(): number {
    return this._elapsedTimeInMilliseconds === -1 ? null : this._elapsedTimeInMilliseconds;
  }

  /**
   * Checks if body contains a specific item. Body must be json formatted, otherwise the function will be aborted
   * @param {string[]} key = e.g if the following item is requested: body.foo.bar.xyz and array with ["foo", "bar", "xyz"] has to provided
   * @return {any} = the item that has been request. Undefined will be returned if no item was found, or the body is not json formatted
   */
  getDataItem(key: string[]): any {
    if (!this.dataJson) return undefined;

    let item = undefined;
    try {
      key.forEach((value, index) => {
        if (index === 0) item = this.dataJson[value];
        else item = item[value];
      });
      return item;
    } catch (e) {
      return undefined;
    }
  }
}
