import * as HttpRequest from "./httpConnection/HttpRequest";
import { validateAll } from "./validation/validate-seed";
import { Guild } from "./database/entity/Guild";
import { Seed } from "./database/entity/Seed";
import { createConnection } from "typeorm";
import { log } from "util";
import { type } from "os";
const fetch = require("node-fetch");
import { JsonRpc } from "eosjs";
import { HttpErrorType } from "./httpConnection/HttpErrorType";
import { sendMessageApi } from "./telegramHandler";
import { Api } from "./database/entity/Api";

function pingWebsite(url: string) {
  HttpRequest.get(url)
    .then((response) => {
      console.log("*** SUCCESS ***");
      console.log("*** TRUE *** Website is online");
    })
    .catch((error) => {
      console.log("*** ERROR ***");
      console.log(error);
    });
}

let apiEndpoint = "https://wax.blacklusion.io";

async function test() {
  let api = new Api();
  let sslMessage = "";
  await HttpRequest.get(apiEndpoint, "", 0)
    .then((response) => {
      api.ssl_ok = true;
      sslMessage = "success";
    })
    .catch((error) => {
      console.log(error);
      console.log(error.type);
      if (typeof error.type != "undefined" && error.type == HttpErrorType.HTTP) {
        api.ssl_ok = true;
        sslMessage = "ssl ok";
      } else if (error.type && error.type == HttpErrorType.SSL) {
        sslMessage = "not ok: " + error.message;
        api.ssl_ok = false;
      } else {
        sslMessage = "could not be validated" + (error.message ? ": " + error.messages : "");
        api.ssl_ok = false;
      }
    });

  console.log(sslMessage);
}

test();
