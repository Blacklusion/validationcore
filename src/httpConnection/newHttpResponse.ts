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

  errorType: HttpErrorType;

  constructor() {
    this.headers = undefined;
    this.data = undefined;

    // Set to -1 to prevent checks on undefined
    this.httpCode = -1;
    this.elapsedTimeInMilliseconds = null;
    this.ok = false;
    this.errorMessage = "";
  }

  async parseFetchResponse(response: Response) {
    this.ok = response.ok;
    this.httpCode = response.status;
    this.headers = response.headers;
    this.data = await response.text();

    if (!this.ok) {
      this.errorMessage = response.statusText;
      this.errorType = HttpErrorType.HTTP;
    }
  }

  parseFetchError(error: any) {
    // Error is Timeout Error
    if (error.message === "timeout" || (error.code && (error.code === "ETIMEDOUT" || error.code == "ECONNABORTED"))) {
      this.errorMessage = "Timeout during request";
      this.errorType = HttpErrorType.TIMEOUT;
    }

    // Error is SSL error
    else if (error.code !== undefined && new RegExp(".*CERT.*").test(error.code)) {
      this.errorMessage =
        "Invalid SSL certificate" +
        (error.message && error.message.includes(", reason:")
          ? " (" + error.message.substring(error.message.indexOf(", reason:") + 10, error.message.length - 1) + ")"
          : "");
      this.errorType = HttpErrorType.SSL;
    }

    // The differentiation between other errors is not really necessary
    else if (error.code !== undefined) {
      this.errorMessage = error.code;
      this.errorType = HttpErrorType.OTHER;
    }

    // The error is not a FetchError -> This should not be the case
    else {
      this.errorMessage = "Unknown Error";
      logger.warn("An unknown error was tried to be parsed durin a httpRequest. This should not be the case: ", error);
      this.errorType = HttpErrorType.UNKNOWN;
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
