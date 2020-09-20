import { HttpErrorType } from "./HttpErrorType";
import { HttpResponse } from "./HttpResponse";

/**
 * Thrown from custom HttpRequest Class
 * Enables easier differentiation between possible errors during http request
 */
export class HttpError extends Error {
  public type: HttpErrorType = HttpErrorType.UNKNOWN;
  public code = -1;
  public message = "";
  public response: HttpResponse = new HttpResponse(null);
  constructor(type: HttpErrorType, code: number, message: string, response: any = undefined) {
    super(message);
    this.type = type;
    this.code = code;
    this.message = message;

    if (response) {
      this.response = new HttpResponse(response);
    }
  }
}
