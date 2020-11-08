import { triggerAsyncId } from "async_hooks";
import { HttpError } from "./HttpError";
import { HttpErrorType } from "./HttpErrorType";
import { logger } from "../common";

export class NewHttpResponse {
  // Header of HttpResponse
  headers: any;

  // Data/Body of HttpResponse
  data: any;

  // ElapsedTime between the request was send and the response was received
  elapsedTimeInMilliseconds: number;

  // If set to true, the request was successful (based on the returned httpCode)
  ok: boolean;

  // Returned httpCode returned by the server
  httpCode: number;

  // Stores the error message of a potential error during the request, including invalid domain errors etc.
  errorMessage: string;

  errorType: errorType;

  constructor() {
    this.headers = undefined;
    this.data = undefined;
    this.httpCode = undefined;
    this.elapsedTimeInMilliseconds = null;
    this.ok = false;
    this.errorMessage = "";
  }

  parseFetchResponse(response: Response) {
    this.ok = response.ok;
    this.httpCode = response.status;
    this.headers = response.headers;
    this.data = response.body;

    if (!this.ok) {
      this.errorMessage = response.statusText;
      this.errorType = errorType.HTTP;
    }
  }

  parseFetchError(error: Error) {

    // Error is Timeout Error
    if (error.message === "Timeout" || (error.code && (error.code === "ETIMEDOUT" || error.code == "ECONNABORTED"))) {
      this.errorMessage = "Timeout during request";
    }

    // Error is SSL error
    else if (error.code !== undefined && new RegExp(".*CERT.*").test(error.code)) {
      this.errorMessage = "Invalid SSL certificate" + ((error.message && error.message.includes(", reason:")) ? " (" + error.message.substring(error.message.indexOf(", reason:") + 10, error.message.length-1) + ")" : "")
      this.errorType = errorType.SSL;
    }

    // The differentiation between other errors is not really necessary
    else if (error.code !== undefined) {
      this.errorMessage = error.code;
      this.errorType = errorType.OTHER;
    }

    // The error is not a FetchError -> This should not be the case
    else {
      this.errorMessage = "Unknown Error";
      this.errorType = errorType.UNKNOWN;
      logger.warn("An unknown error was tried to be parsed durin a httpRequest. This should not be the case: ", error);
    }
  }

  /**
   * Checks if body can be parsed into a valid JSON
   */
  public isJson(): boolean {
    try {
      JSON.parse(this.data);
      return true;
    } catch (e) {
      return false;
    }
  }

  setErrorMessage(message: string) {
    this.errorMessage = message;
  }

  getFormattedErrorMessage() {
    if (!this.errorMessage || this.errorMessage === "") return "";
    else return ": " + this.errorMessage;
  }
}

enum errorType {
  HTTP,
  SSL,
  OTHER,
  UNKNOWN
}
