export class NewHttpResponse {
  // Header of HttpResponse
  headers: any;

  // Data/Body of HttpResponse
  data: any;

  // ElapsedTime between the request was send and the response was received
  elapsedTimeInMilliseconds: number;

  isOk: boolean;

  errorMessage: string;

  constructor() {
    this.headers = undefined;
    this.data = undefined;
    this.elapsedTimeInMilliseconds = null;
    this.isOk = false;
    this.errorMessage = ""
  }

  parseFetchResponse(response: Response) {
    this.isOk = response.ok;
    this.headers = response.headers;
    this.data = response.body;
  }

  parseFetchError(error: Error) {

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

  public getFormattedErrorMessage() {
    if (!this.errorMessage || this.errorMessage === "") return "";
    else return ": " + this.errorMessage;
  }
}
