import * as config from "config";
import * as express from "express";
import { logger, sleep } from "./validationcore-database-scheme/common";
import { validateAllChains } from "./validation/validate-chain";
import * as http from "./httpConnection/HttpRequest";
import * as bodyParser from "body-parser";


/**
 * Starts a webserver to listen for starting signal from master and closes it as soon as the signal was received
 */
export function startSlaveServer(): void {
  const app = express();
  const port = config.get("general.slaves_port");

  app.use(bodyParser.json());

// define a route handler for the default home page
  app.post("/start", (req, res) => {
    if (req && req.body && req.body["auth-token"] === config.get("general.slaves_authentication_token")) {
      logger.info("*** Received starting signal...")
      res.status(200).send("Success");

      validateAllChains();
      setInterval(validateAllChains, config.get("validation.validation_round_interval"));

      server.close();
      logger.info("*** Server was closed and no further signals are accepted")
    } else {
      logger.error("*** Received invalid starting signal. Check authentication token in config/local.toml")
      res.status(401).send("Wrong authentication token");
    }
  });


// start the Express server
  const server = app.listen(port, () => {
    logger.info('Server is running and waiting for a starting signal on port ' + config.get("general.slaves_port") + "...");
  });
}

/**
 * Sends starting signal to every slave. Between every slave the interval general.validation_round_slave_delta is waited
 * Should be only called once during executing
 */
export async function sendStartSignalToSlaves(): Promise<void> {
  for (const slave of config.get("general.slaves")) {
  await sleep(config.get("validation.validation_round_slave_delta"));
    http.post("http://" + slave + ":" + config.get("general.slaves_port"), "/start", {"auth-token": config.get("general.slaves_authentication_token")}).then((response) => {
      if (response.ok) {
        logger.info('*** Starting signal to slave ' + slave + ' was sent successfully');
      } else {
        logger.error('*** Starting signal to slave ' + slave + ' could not be sent', + response.errorMessage)
      }
    })
  }
}