
export class NewHttpResponse {
  // Header of HttpResponse
  headers: any;

  // Data/Body of HttpResponse
  data: any;

  // ElapsedTime between the request was send and the response was received
  elapsedTimeInMilliseconds: number = null;

  isOk: boolean;

  errorMessage = ""


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
    this.isOk = false;
    this.errorMessage = message;
  }

  public getFormattedErrorMessage() {
    if (!this.errorMessage)
      return "";
    else
      return ": " + this.errorMessage;
  }
}