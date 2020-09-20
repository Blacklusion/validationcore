import { EOSIOStreamDeserializer } from "eosio-protocol";
import { EOSIOStreamTokenizer } from "eosio-protocol";
import { EOSIOStreamConsoleDebugger } from "eosio-protocol";
import { EOSIOP2PClientConnection } from "eosio-protocol";
import { GoAwayMessage, HandshakeMessage, SyncRequestMessage } from "eosio-protocol";
import { sleep } from "eosio-protocol";
import * as config from "config";
import * as stream from "stream";
import fetch = require("node-fetch");
import { logger } from "../common";
import { getConnection } from "typeorm";
import { Seed } from "../database/entity/Seed";
import { Guild } from "../database/entity/Guild";
import { Logger } from "tslog";
import { evaluateMessage, sendMessageSeed } from "../telegramHandler";

/**
 * Logger Settings for Organization
 */
const childLogger: Logger = logger.getChildLogger({
  name: "P2P-Validation",
  minLevel: "debug",
});

// todo: move debug to config
const debug = false;

// todo: remove "Connected to p2p"
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

  run(debug = false) {
    console.log(`Test runner doesnt override run`);
  }

  protected async send_handshake(override) {
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

class BlockTransmissionTestRunner extends TestRunner {
  // @ts-ignore
  private kill_timer: NodeJS.Timeout;

  constructor(node: any, num_blocks: number) {
    super(node, num_blocks);
  }

  async on_signed_block(msg): Promise<void> {
    // console.log('TestRunner:on_signed_block');
    clearTimeout(this.kill_timer);
    this.kill_timer = setTimeout(this.kill.bind(this), this.blockTimeout);

    this.blockCount++;
    const block_num_hex = msg.previous.substr(0, 8); // first 64 bits
    const block_num = parseInt(block_num_hex, 16) + 1;
    // @ts-ignore
    const tm = process.hrtime.bigint();
    if (this.lastBlockTime > 0) {
      const latency = Number(tm - this.lastBlockTime);
      this.latencies.push(latency);
      // console.log(`Received block : ${block_num} signed by ${msg.producer} with latency ${latency} - ${this.block_count} received from ${this.node.host}`);
    }
    this.lastBlockTime = tm;
  }

  async on_error(e): Promise<void> {
    this.killed = true;
    this.killedReason = e.code;
    this.killedDetail = (e + "").replace("Error: ", "");
  }

  log_results(results): void {
    console.log(JSON.stringify(results));
  }

  async run(debug = false): Promise<any> {
    this.kill_timer = setTimeout(this.kill.bind(this), this.blockTimeout);

    const num_blocks = this.numBlocks;

    const p2p = this.p2p;

    p2p.on("net_error", (e) => {
      this.killed = true;
      this.killedReason = "net_error";
      this.killedDetail = e.message;
    });

    try {
      const client: stream.Stream = await p2p.connect();

      const deserialized_stream = client
        .pipe(new EOSIOStreamTokenizer({}))
        .pipe(new EOSIOStreamDeserializer({}))
        .on("data", (obj) => {
          if (obj[0] === 7) {
            this.on_signed_block(obj[2]);
          }
          if (obj[0] === 2) {
            this.killed = true;
            this.killedReason = "go_away";
            // @ts-ignore
            this.killedDetail = `Received go away message ${GoAwayMessage.reasons[obj[2].reason]}`;
          }
        });

      if (debug) {
        deserialized_stream.pipe(new EOSIOStreamConsoleDebugger({ prefix: "<<<" }));
      }

      const res = await fetch(`${this.node.api}/v1/chain/get_info`);
      const info = await res.json();

      const prev_info = await this.get_prev_info(info, num_blocks);
      // const prev_info = info;

      const override = {
        chain_id: info.chain_id,
        p2p_address: "blacklusionPager - a6f45b4",
        last_irreversible_block_num: prev_info.last_irreversible_block_num,
        last_irreversible_block_id: prev_info.last_irreversible_block_id,
        head_num: prev_info.head_block_num,
        head_id: prev_info.head_block_id,
      };
      await this.send_handshake(override);

      // get num blocks before lib
      const msg = new SyncRequestMessage();
      msg.start_block = prev_info.last_irreversible_block_num;
      msg.end_block = prev_info.last_irreversible_block_num + num_blocks;
      await p2p.send_message(msg);
    } catch (e) {}

    const results = await this.wait_for_tests(num_blocks);
    p2p.disconnect();

    return results;
  }

  async get_block_id(block_num_or_id: number | string): Promise<string> {
    const res = await fetch(`${this.node.api}/v1/chain/get_block`, {
      method: "POST",
      body: JSON.stringify({ block_num_or_id }),
    });
    const info = await res.json();

    return info.id;
  }

  async get_prev_info(info: any, num = 1000) {
    if (num > 0) {
      info.head_block_num -= num;
      info.last_irreversible_block_num -= num;
      info.head_block_id = await this.get_block_id(info.head_block_num);
      info.last_irreversible_block_id = await this.get_block_id(info.last_irreversible_block_num);
    }

    return info;
  }

  async get_result_json(): Promise<Object> {
    const raw = {
      status: "success",
      block_count: this.blockCount,
      latencies: this.latencies,
      error_code: this.killedReason,
      error_detail: this.killedDetail,
    };

    raw.status = !this.killedReason ? "success" : "error";

    let avg = 0;
    let sum = 0;
    let sum_b = BigInt(0);
    if (raw.latencies.length > 0) {
      sum = raw.latencies.reduce((previous, current) => (current += previous));
      sum_b = BigInt(sum_b);
      avg = sum / raw.latencies.length;
    }

    const ns_divisor = Math.pow(10, 9);
    const total_time = sum / ns_divisor;
    const blocks_per_ns = raw.block_count / sum;
    let speed = (blocks_per_ns * ns_divisor).toFixed(10);
    if (speed === "NaN") {
      speed = "";
    }

    const results = {
      host: `${this.node.host}:${this.node.port}`,
      status: raw.status,
      error_code: raw.error_code,
      error_detail: raw.error_detail,
      blocks_received: raw.block_count,
      total_test_time: total_time,
      speed: speed,
    };

    return results;
  }

  async wait_for_tests(num) {
    return new Promise(async (resolve, reject) => {
      while (true) {
        if (this.blockCount >= num) {
          clearTimeout(this.kill_timer);
          resolve(this.get_result_json());
          break;
        }

        if (this.killed) {
          clearTimeout(this.kill_timer);
          resolve(this.get_result_json());
          break;
        }
        await sleep(1000);
      }
    });
  }

  kill(): void {
    this.killed = true;
    this.killedReason = "timeout";
    this.killedDetail = "Timed out while receiving blocks";
  }
}

export async function validateAll(
  guild: Guild,
  lastValidation: Seed,
  isMainnet: boolean,
  p2pEndpoint: string,
  locationOk: boolean
): Promise<Seed> {
  if (!p2pEndpoint) return undefined;

  // Set general variables
  const api: string = isMainnet ? config.get("mainnet.api_endpoint") : config.get("testnet.api_endpoint");
  let pagerMessages: Array<string> = [];

  // Create seed object for database
  const database = getConnection();
  const seed: Seed = new Seed();
  seed.guild = guild.name;
  seed.validation_is_mainnet = isMainnet;
  seed.location_ok = locationOk;
  seed.p2p_endpoint = p2pEndpoint;

  if (!lastValidation) lastValidation = new Seed();

  /**
   * Test 1: Check url
   */
  if (new RegExp("^https?:\\/\\/").test(p2pEndpoint) || !new RegExp(".+:[0-9]+").test(p2pEndpoint)) {
    logger.debug("FALSE \t Invalid p2p url");
    seed.p2p_endpoint_address_ok = false;
    return;
  } else {
    logger.debug("TRUE \t Valid p2p url");
    seed.p2p_endpoint_address_ok = true;
  }
  pagerMessages.push(
    evaluateMessage(
      lastValidation.p2p_endpoint_address_ok,
      seed.p2p_endpoint_address_ok,
      "Provided P2P address",
      "valid",
      "invalid"
    )
  );

  /**
   * 2. Create Seed Connection
   */
  const node = {
    api: api,
    host: p2pEndpoint.substring(0, p2pEndpoint.indexOf(":")),
    port: p2pEndpoint.substring(p2pEndpoint.indexOf(":") + 1, p2pEndpoint.length),
  };
  const runner: BlockTransmissionTestRunner = new BlockTransmissionTestRunner(
    node,
    config.get("validation.p2p_block_count")
  );
  await runner
    .run(debug)
    .then((result) => {
      /**
       * Test 2.1: p2p Connection successful
       */
      if (result.status == "success") {
        logger.debug("TRUE \t Seed Connection to " + p2pEndpoint + " successful");
        seed.p2p_connection_possible = true;

        /**
         * Test 2.2: block transmission speed ok
         */
        if (result.speed && result.speed > config.get("validation.p2p_ok_speed")) {
          logger.debug("TRUE \t Block Transmission Speed OK");
          seed.block_transmission_speed_ok = true;
          seed.block_transmission_speed_ms = Math.round(result.speed);
        } else {
          logger.debug("FALSE \t Block Transmission Speed too slow");
          seed.block_transmission_speed_ok = false;
        }
        pagerMessages.push(
          evaluateMessage(
            lastValidation.block_transmission_speed_ok,
            seed.block_transmission_speed_ok,
            "Block transmission speed is",
            "OK",
            "too slow"
          )
        );
      } else {
        logger.debug(
          "FALSE \t Seed Connection failed due to a " +
            result.error_code +
            " error with the message: " +
            result.error_detail
        );
        seed.p2p_connection_possible = false;
      }
      pagerMessages.push(
        evaluateMessage(
          lastValidation.p2p_connection_possible,
          seed.p2p_connection_possible,
          "P2P connection was",
          "possible",
          "not possible" + (result.error_detail ? ": " + result.error_detail : "")
        )
      );
    })
    .catch((error) => {
      // todo: improve error handling, test with block_count =  "10"
      console.log(error);
    });

  /**
   * All checks ok
   */
  seed.all_checks_ok = seed.p2p_endpoint_address_ok && seed.p2p_connection_possible && seed.block_transmission_speed_ok;

  /**
   * Store results in Database
   */
  try {
    await database.manager.save(seed);
    childLogger.info("SAVED \t New Seed validation to database for " + guild.name);
  } catch (error) {
    childLogger.fatal("Error while saving new Seed validation to database", error);
  }

  /**
   * Send Message to all subscribers of guild via. public telegram service
   */
  pagerMessages = pagerMessages.filter((message) => message);
  if (pagerMessages.length > 0)
    sendMessageSeed(
      guild.name,
      isMainnet,
      "<b>" +
        (isMainnet ? "Mainnet" : "Testnet") +
        " P2P results for: " +
        p2pEndpoint +
        "</b> \\n" +
        pagerMessages.join("\\n")
    );

  return seed;
}
