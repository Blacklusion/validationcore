import * as axios from "axios";
import { logger } from "../common";

/**
 * Custom HttpRequest Class returns HttpResponse object
 */
export class HttpResponse {
  // Header of HttpResponse
  headers: any;

  // Data/Body of HttpResponse
  data: any;

  //
  isJson = false;

  // ElapsedTime between the request was send and the response was received
  elapsedTimeInMilliseconds: number = null;

  // todo: necessary?
  response: object;

  constructor(response: axios.AxiosResponse) {
    if (!response) {
      return;
    }

    this.headers = response.headers;
    this.data = response.data;

    // Axios already parses json to object
    //todo: improve check to support all edge cases
    this.isJson = typeof this.data == "object";

    // Calculate elapsed time between request and response
    try {
      this.elapsedTimeInMilliseconds = Date.now() - response.config.headers["request-startTime"];
    } catch (e) {
      logger.error("No requestStarttime found in response header: ", this.headers);
    }
  }

  /*
    then<TResult1 = object, TResult2 = never>(onfulfilled?: ((value: object) => (PromiseLike<TResult1> | TResult1)) | undefined | null, onrejected?: ((reason: any) => (PromiseLike<TResult2> | TResult2)) | undefined | null): PromiseLike<TResult1 | TResult2> {
        return Promise.resolve(undefined);
    }
     */
}
