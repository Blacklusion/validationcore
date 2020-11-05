import * as fetch from "node-fetch";
import { HttpResponse } from "./newHttpResponse";

export async function request (
  base: string,
  path = "",
  payloadAsJson: string = undefined,
  retryCounter: number = config.get("validation.request_retry_count"),
  contentType = "application/json"
): HttpResponse {
  const response = new HttpResponse();

  // Check if base url was provided
  if (!base || base === "") {
    response.setErrorMessage("No url was provided");
    return response;
  }

  // Combine base and path to url
  //todo: (optional) check for generic domainnames: google.de etc.
  let urlWithPath: URL;
  try {
    urlWithPath = new URL(path, base);
  } catch (e) {
    response.setErrorMessage("Invalid url formatting");
    return response;
  }

  // Send Request
  if (!payloadAsJson) {
    await fetch(urlWithPath, {
      method: 'GET', headers: {
        "request-startTime": Date.now()
      }
    })
  } else {

    // todo: decide if really necessary
    // todo: check if content type match is necessary
    try {
      JSON.parse(payloadAsJson)
    } catch (e) {
      response.setErrorMessage("Payload for post request is not valid JSON")
      return response;
    }

    await fetch(urlWithPath, {
      method: 'POST', headers: {
        "request-startTime": Date.now(),
        "content-type": contentType,
      },
      data: payloadAsJson
    })


  }

}