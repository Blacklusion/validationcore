import { EOSIOStreamDeserializer } from "eosio-protocol";
import { EOSIOStreamTokenizer } from "eosio-protocol";
import { EOSIOStreamConsoleDebugger } from "eosio-protocol";
import { EOSIOP2PClientConnection } from "eosio-protocol";
import { GoAwayMessage, HandshakeMessage, SyncRequestMessage } from "eosio-protocol";
import { sleep } from "eosio-protocol";
import * as config from "config";
import * as stream from "stream";
import fetch = require("node-fetch");
import {
  calculateValidationLevel,
  logger,
  allChecksOK, validateBpLocation, extractLongitude, extractLatitude
} from "../validationcore-database-scheme/common";
import { getConnection } from "typeorm";
import { NodeSeed } from "../validationcore-database-scheme/entity/NodeSeed";
import { Guild } from "../validationcore-database-scheme/entity/Guild";
import { Logger } from "tslog";
import { isURL } from "validator";
import { ValidationLevel } from "../validationcore-database-scheme/enum/ValidationLevel";
import { getChainsConfigItem } from "../validationcore-database-scheme/readConfig";
import { globalNodeSeedQueue } from "../index";

/**
 * This code is based on the original code of "EOSIO Protocol", published by Michael Yeates
 * Only the method validateSeed() was implemented by Blacklusion
 *
 *              https://github.com/michaeljyeates/eosio-protocol
 *
 *                              © Michael Yeates
 */

/**
 * Logger Settings for Validation
 */
const childLogger: Logger = logger.getChildLogger({
  name: "P2P-Validation",
});

const configLoggingLevel = config.get("general.logging_level");
const debug = configLoggingLevel === "silly" || configLoggingLevel === "trace";

// eslint-disable-next-line require-jsdoc
class TestRunner {
  protected lastBlockTime: bigint;
  protected blockCount: number;
  protected node: any;
  protected killedReason: string;
  protected killedDetail: string;
  protected killed: boolean;
  protected latencies: number[];
  protected blockTimeout: number;
  protected p2p: EOSIOP2PClientConnection;
  protected numBlocks: number;

  // eslint-disable-next-line require-jsdoc
  constructor(node: any, numBlocks: number) {
    this.node = node;
    this.lastBlockTime = BigInt(0);
    this.blockCount = 0;
    this.killed = false;
    this.killedReason = "";
    this.killedDetail = "";
    this.latencies = [];
    this.blockTimeout = 10000;
    this.numBlocks = numBlocks;

    const p2p = new EOSIOP2PClientConnection({ ...this.node, ...{ debug } });
    this.p2p = p2p;
  }

  // eslint-disable-next-line require-jsdoc
  run(debug = false) {
    console.log(`Test runner doesnt override run`);
  }

  // eslint-disable-next-line require-jsdoc
  protected async sendHandshake(override) {
    const msg = new HandshakeMessage();
    msg.copy({
      network_version: 1206,
      chain_id: "0000000000000000000000000000000000000000000000000000000000000000", // should be o
      node_id: "0585cab37823404b8c82d6fcc66c4faf20b0f81b2483b2b0f186dd47a1230fdc",
      key: "PUB_K1_11111111111111111111111111111111149Mr2R",
      time: "1574986199433946000",
      token: "0000000000000000000000000000000000000000000000000000000000000000",
      sig: "SIG_K1_111111111111111111111111111111111111111111111111111111111111111116uk5ne",
      p2p_address: `eosdac-p2p-client:9876 - a6f45b4`,
      last_irreversible_block_num: 0,
      last_irreversible_block_id: "0000000000000000000000000000000000000000000000000000000000000000",
      head_num: 0,
      head_id: "0000000000000000000000000000000000000000000000000000000000000000",
      os: "linux",
      agent: "Dream Ghost",
      generation: 1,
    });

    if (override) {
      msg.copy(override);
    }

    await this.p2p.send_message(msg);
  }
}

// eslint-disable-next-line require-jsdoc
class BlockTransmissionTestRunner extends TestRunner {
  // @ts-ignore
  private killTimer: NodeJS.Timeout;

  // eslint-disable-next-line require-jsdoc
  constructor(node: any, numBlocks: number) {
    super(node, numBlocks);
  }

  // eslint-disable-next-line require-jsdoc
  async onSignedBlock(msg): Promise<void> {
    // console.log('TestRunner:on_signed_block');
    clearTimeout(this.killTimer);
    this.killTimer = setTimeout(this.kill.bind(this), this.blockTimeout);

    this.blockCount++;
    // const blockNumHex = msg.previous.substr(0, 8); // first 64 bits
    // const blockNum = parseInt(blockNumHex, 16) + 1;
    // @ts-ignore
    const tm = process.hrtime.bigint();
    if (this.lastBlockTime > 0) {
      const latency = Number(tm - this.lastBlockTime);
      this.latencies.push(latency);
      // console.log(`Received block : ${blockNum} signed by ${msg.producer} with latency ${latency} - ${this.block_count} received from ${this.node.host}`);
    }
    this.lastBlockTime = tm;
  }

  // eslint-disable-next-line require-jsdoc
  async onError(e): Promise<void> {
    this.killed = true;
    this.killedReason = e.code;
    this.killedDetail = (e + "").replace("Error: ", "");
  }

  // eslint-disable-next-line require-jsdoc
  logResults(results): void {
    console.log("Results of SeedNode" + JSON.stringify(results));
  }

  // eslint-disable-next-line require-jsdoc
  async run(debug = false): Promise<any> {
    this.killTimer = setTimeout(this.kill.bind(this), this.blockTimeout);

    const numBlocks = this.numBlocks;

    const p2p = this.p2p;

    p2p.on("net_error", (e) => {
      this.killed = true;
      this.killedReason = "net_error";
      this.killedDetail = e.message;
    });

    try {
      const client: stream.Stream = await p2p.connect();

      const deserializedStream = client
        .pipe(new EOSIOStreamTokenizer({}))
        .pipe(new EOSIOStreamDeserializer({}))
        .on("data", (obj) => {
          if (obj[0] === 7) {
            this.onSignedBlock(obj[2]);
          }
          if (obj[0] === 2) {
            this.killed = true;
            this.killedReason = "go_away";
            // @ts-ignore
            this.killedDetail = `Received go away message ${GoAwayMessage.reasons[obj[2].reason]}`;
          }
        });

      if (debug) {
        deserializedStream.pipe(new EOSIOStreamConsoleDebugger({ prefix: "<<<" }));
      }

      const res = await fetch(`${this.node.api}/v1/chain/get_info`);
      const info = await res.json();

      const prevInfo = await this.getPrevInfo(info, numBlocks);
      // const prevInfo = info;

      const override = {
        chain_id: info.chain_id,
        p2p_address: "validationcore.blacklusion.io:9876 - a6f45b4",
        last_irreversible_block_num: prevInfo.last_irreversible_block_num,
        last_irreversible_block_id: prevInfo.last_irreversible_block_id,
        head_num: prevInfo.head_block_num,
        head_id: prevInfo.head_block_id,
      };
      await this.sendHandshake(override);

      // get num blocks before lib
      const msg = new SyncRequestMessage();
      msg.start_block = prevInfo.last_irreversible_block_num;
      msg.end_block = prevInfo.last_irreversible_block_num + numBlocks;
      await p2p.send_message(msg);
    } catch (e) {}

    const results = await this.waitForTests(numBlocks);
    p2p.disconnect();

    return results;
  }

  // eslint-disable-next-line require-jsdoc
  async getBlockId(blockNumOrId: number | string): Promise<string> {
    const res = await fetch(`${this.node.api}/v1/chain/get_block`, {
      method: "POST",
      body: JSON.stringify({ block_num_or_id: blockNumOrId }),
    });
    const info = await res.json();

    return info.id;
  }

  // eslint-disable-next-line require-jsdoc
  async getPrevInfo(info: any, num = 1000) {
    if (num > 0) {
      info.head_block_num -= num;
      info.last_irreversible_block_num -= num;
      info.head_block_id = await this.getBlockId(info.head_block_num);
      info.last_irreversible_block_id = await this.getBlockId(info.last_irreversible_block_num);
    }

    return info;
  }

  // eslint-disable-next-line require-jsdoc
  async getResultJson(): Promise<Object> {
    const raw = {
      status: "success",
      block_count: this.blockCount,
      latencies: this.latencies,
      error_code: this.killedReason,
      error_detail: this.killedDetail,
    };

    raw.status = !this.killedReason ? "success" : "error";

    // let avg = 0;
    let sum = 0;
    // let sumB = BigInt(0);
    if (raw.latencies.length > 0) {
      sum = raw.latencies.reduce((previous, current) => (current += previous));
      // sumB = BigInt(sumB);
      // avg = sum / raw.latencies.length;
    }

    const nsDivisor = Math.pow(10, 9);
    const totalTime = sum / nsDivisor;
    const blocksPerNs = raw.block_count / sum;
    let speed = (blocksPerNs * nsDivisor).toFixed(10);
    if (speed === "NaN") {
      speed = "";
    }

    const results = {
      host: `${this.node.host}:${this.node.port}`,
      status: raw.status,
      error_code: raw.error_code,
      error_detail: raw.error_detail,
      blocks_received: raw.block_count,
      total_test_time: totalTime,
      speed: speed,
    };

    return results;
  }

  // eslint-disable-next-line require-jsdoc
  async waitForTests(num) {
    return new Promise(async (resolve, reject) => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (this.blockCount >= num) {
          clearTimeout(this.killTimer);
          resolve(this.getResultJson());
          break;
        }

        if (this.killed) {
          clearTimeout(this.killTimer);
          resolve(this.getResultJson());
          break;
        }
        await sleep(1000);
      }
    });
  }

  // eslint-disable-next-line require-jsdoc
  kill(): void {
    this.killed = true;
    this.killedReason = "timeout";
    this.killedDetail = "Timed out while receiving blocks";
  }
}

/**
 *
 * @param {Guild} guild = guild for which the Seed is validated (must be tracked in database)
 * @param {string} chainId = chainId of chain that is validated
 * @param {string} endpointUrl = url of the p2p endpoint
 * @param {unknown} location = location information as in bp.json
 */
export async function validateSeed(
  guild: Guild,
  chainId: string,
  endpointUrl: string,
  location: unknown
): Promise<NodeSeed> {
  if (!endpointUrl) return undefined;

  // Set general variables
  const api: string = getChainsConfigItem(chainId, "api_endpoint");

  // Create seed object for database
  const database = getConnection(chainId);
  const seed: NodeSeed = new NodeSeed();
  seed.instance_id = config.get("general.instance_id")
  seed.guild = guild.name;
  seed.endpoint_url = endpointUrl;

  if (getChainsConfigItem(chainId, "nodeSeed_location")) {
    seed.location_ok = calculateValidationLevel(validateBpLocation(location), chainId, "nodeSeed_location_level");
    seed.location_longitude = extractLongitude(location);
    seed.location_latitude = extractLatitude(location);
  }
  /**
   * Test 1: Check url
   */
  const endpointUrlOk = isURL(endpointUrl, {
    protocols: [],
    require_protocol: false,
    require_port: true,
  });
  seed.endpoint_url_ok = calculateValidationLevel(endpointUrlOk, chainId, "nodeSeed_endpoint_url_ok_level");

  if (!seed.endpoint_url_ok) return seed;

  /**
   * 2. Create Seed Connection
   */
  try {
    const node = {
      api: api,
      host: endpointUrl.substring(0, endpointUrl.indexOf(":")),
      port: endpointUrl.substring(endpointUrl.indexOf(":") + 1, endpointUrl.length),
    };
    const runner: BlockTransmissionTestRunner = new BlockTransmissionTestRunner(
      node,
      config.get("validation.seed_block_count")
    );
    await globalNodeSeedQueue.add(() => runner
      .run(debug)
      .then((result) => {
        /**
         * Test 2.1: p2p Connection successful
         */
        if (result.status == "success") {
          seed.p2p_connection_possible = calculateValidationLevel(
            true,
            chainId,
            "nodeSeed_p2p_connection_possible_level"
          );

          /**
           * Test 2.2: block transmission speed ok
           */
          if (getChainsConfigItem(chainId, "nodeSeed_block_transmission_speed_ok")) {
            if (result.speed && result.speed > config.get("validation.seed_ok_speed")) {
              seed.block_transmission_speed_ok = calculateValidationLevel(
                true,
                chainId,
                "nodeSeed_block_transmission_speed_ok_level"
              );
              seed.block_transmission_speed_ms = Math.round(result.speed);
            } else {
              seed.block_transmission_speed_ok = calculateValidationLevel(
                false,
                chainId,
                "nodeSeed_block_transmission_speed_ok_level"
              );
            }
          }
        } else {
          seed.p2p_connection_possible = calculateValidationLevel(
            false,
            chainId,
            "nodeSeed_p2p_connection_possible_level"
          );
        }

        seed.p2p_connection_possible_message = result.error_detail ? result.error_detail : null;
      })
      .catch((error) => {
        // todo: improve error handling, test with block_count =  "10"
        childLogger.warn("Error during NodeSeed validation", error);
      }))
  } catch (e) {
    childLogger.warn("Error during NodeSeed validation", e);
  }

  /**
   * All checks ok
   */
  const validations: [string, ValidationLevel][] = [
    ["nodeSeed_location", seed.location_ok],
    ["nodeSeed_endpoint_url_ok", seed.endpoint_url_ok],
    ["nodeSeed_p2p_connection_possible", seed.p2p_connection_possible],
    ["nodeSeed_block_transmission_speed_ok", seed.block_transmission_speed_ok],
  ];
  seed.all_checks_ok = allChecksOK(validations, chainId);

  /**
   * Store results in Database
   */
  try {
    await database.manager.save(seed);
    childLogger.debug(
      "SAVED \t New Seed validation to database for " +
        guild.name +
        " " +
        getChainsConfigItem(chainId, "name") +
        " to database"
    );
  } catch (error) {
    childLogger.fatal("Error while saving new Seed validation to database", error);
  }

  return seed;
}
