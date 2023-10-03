/**
 * Note: this implements the most simplistic of Xmodem spec, specifically the
 * weak checksum and no support for `CAN`
 *
 * Based on https://en.m.wikipedia.org/wiki/XMODEM and
 * https://www.geeksforgeeks.org/xmodem-file-transfer-protocol/
 *
 * Remy Sharp
 * 2023-10-03
 */

import Event from "./Event.js";

const SOH = 0x01;
const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;
const FILLER = 0x1a;

const PACKET_SIZE = 128;
const BLOCK_SIZE = PACKET_SIZE + 4;
const POS_CHECKSUM = BLOCK_SIZE - 1;

/**
 * First block number. Don't change this unless you have need for non-standard
 * implementation.
 * @constant
 * @type {integer}
 * @default
 */
const XMODEM_START_BLOCK = 1;

/**
 * Instantiate by `var xmodem = require('xmodem.js');`
 * @class
 * @classdesc XMODEM Protocol in JavaScript
 * @name Xmodem
 * @license BSD-2-Clause
 */
export default class Xmodem extends Event {
  static commands = {
    0x01: "SOH",
    0x04: "EOT",
    0x06: "ACK",
    0x15: "NAK",
  };

  /**
   * @param {SerialPort} socket
   * @param {number} baudRate
   */
  constructor(socket, baudRate) {
    super();

    socket
      .open({ baudRate })
      .then(() => {
        this.socket = socket;
        this.log(`xmodem instance created @ ${baudRate}`);
      })
      .catch((e) => {
        this.log(`FAILURE: ${e.message}`);
      });
  }

  /**
   * @param {Array} data - data to be sent (not typed)
   */
  send = async function (data) {
    const socket = this.socket;
    const pagedBuffer = new Array([null]); // paged buffer starts at 1, not 0
    let packetId = XMODEM_START_BLOCK;
    let packet = new Uint8Array(PACKET_SIZE);

    this.log(`sending ${data.length} bytes`);

    while (data.length > 0) {
      for (let i = 0; i < PACKET_SIZE; i++) {
        packet[i] = data[i] === undefined ? FILLER : data[i];
      }
      data = data.slice(PACKET_SIZE);
      pagedBuffer.push(packet);
      packet = new Uint8Array(PACKET_SIZE);
    }

    this.emit(
      "log",
      `created ${pagedBuffer.length - 1} pages of ${PACKET_SIZE} bytes`
    );

    let sentEOF = false;

    const sendData = async (data) => {
      const cmd = data[0];
      this.emit("cmd", cmd);

      this.log(`< ${Xmodem.commands[cmd]}`);

      if (sentEOF) {
        if (cmd === ACK) {
          this.log(`completed send transmission`);
          return true; // finished
        }

        // something went wrong
        this.emit(
          "log",
          `FAILURE: sent EOT but unexpected response: ${cmd} (${Xmodem.commands[cmd]})`
        );
        throw new Error(
          `Sent EOT but unexpected response: ${cmd} (${Xmodem.commands[cmd]})`
        );
      }

      // if there's an error in the transmission
      if (cmd === NAK && packetId > XMODEM_START_BLOCK) {
        this.log(`resending last packet`);
        packetId--;
      }

      // if we've reached the end of the paged data
      if (cmd === ACK && packetId === pagedBuffer.length) {
        sentEOF = true;
        return this.writeByte(EOT);
      }

      // send some data (ACK = start, NAK = continue)
      if (cmd === NAK || cmd === ACK) {
        this.emit("cmd", SOH);
        this.log(`> SOH packetId: ${packetId}`);

        const buffer = new Uint8Array(BLOCK_SIZE);
        buffer.set([SOH, packetId, 0xff - packetId]);
        buffer.set(pagedBuffer[packetId], 3); // set packet at offset 3
        buffer.set([getChecksum(pagedBuffer[packetId])], POS_CHECKSUM);

        await write(socket, buffer);

        this.emit(
          "status",
          `${packetId}/${pagedBuffer.length - 1}, ${
            packetId * PACKET_SIZE
          } bytes`
        );
        packetId++;
      } else {
        this.emit(
          "log",
          `FAILURE: Unexpected response: ${cmd} (${Xmodem.commands[cmd]})`
        );
        throw new Error(
          `Unexpected response: ${cmd} (${Xmodem.commands[cmd]})`
        );
      }
    };

    this.log(`start send, waiting for NAK`);
    await read(socket, sendData);
  };

  async receive() {
    let nextId = 1;

    const packets = [];

    /**
     * @param {Uint8Array} data
     */
    const process = (data) => {
      const packetId = data[1];
      const packetIdCheck = data[2];

      const packet = data.slice(3, POS_CHECKSUM);
      const checksum = getChecksum(packet);

      this.log(`< SOH packetId: ${packetId}`);

      if (checksum !== data[POS_CHECKSUM]) {
        // bad packet
        this.log(`bad checksum ${checksum} != ${data[POS_CHECKSUM]}`);
        return this.writeByte(NAK);
      }

      if (packetId + packetIdCheck !== 255) {
        // validation check fail
        this.emit(
          "log",
          `1s complement bad ${packetId} + ${packetIdCheck} != 255`
        );
        return this.writeByte(NAK);
      }

      if (packetId !== nextId) {
        this.log(`unexpected packetId - sending NAK`);
        return this.writeByte(NAK);
      }

      // roll the nextId allowing for more than 255 packets
      nextId = (nextId + 1) % 256;

      packets.push(packet);

      this.emit("status", packets.length * PACKET_SIZE);

      return this.writeByte(ACK); // ask for more
    };

    this.log(`start receive`);

    // immediately keep sending a NAK to tell device we want to accept data
    const timer = setInterval(() => this.writeByte(NAK), 3000);

    let reply = new Uint8Array(BLOCK_SIZE);
    let offset = 0;
    let waitingForEot = false;
    await read(this.socket, async (data) => {
      clearTimeout(timer);

      const first = data[0];
      if (offset === 0) {
        this.emit("cmd", first);
        this.log(`< ${Xmodem.commands[first]}`);
        // check first byte
        if (waitingForEot) {
          if (first !== EOT) {
            await this.writeByte(NAK);
            this.log(`FAILURE: Expected EOT: ${data.toString()}`);
            throw new Error(`Expected EOT: ${data.toString()}`);
          }
          await this.writeByte(ACK);
          this.log(`completed receive transmission`);
          return true;
        }

        if (first === EOT) {
          await this.writeByte(NAK);
          waitingForEot = true;
          return;
        }
      }

      reply.set(data, offset);
      offset += data.byteLength;

      if (offset === BLOCK_SIZE) {
        offset = 0;
        await process(reply);
        reply = new Uint8Array(BLOCK_SIZE);
      }
    });

    return packets;
  }

  /**
   * @param {number} byte int8
   * @returns {Promise}
   */
  writeByte(byte) {
    this.emit("cmd", byte);
    this.log(`> ${Xmodem.commands[byte]}`);
    return write(this.socket, new Uint8Array([byte]));
  }

  /**
   * @param {string} msg
   */
  log(msg) {
    this.emit("log", msg);
  }
}

/**
 * @param {Array|TypedArray} data
 * @returns {number} 8bit checksum based on sum of data mod 256
 */
function getChecksum(data) {
  return Array.from(data).reduce((acc, curr) => (acc += curr), 0) % 256;
}

/**
 *
 * @param {SerialPort} socket
 * @param {ArrayBuffer} buffer
 * @returns {Promise}
 */
function write(socket, buffer) {
  const writer = socket.writable.getWriter();
  return writer
    .write(buffer)
    .catch((e) => {
      console.log("socket write fail", e);
    })
    .finally(() => {
      writer.releaseLock();
    });
}

/**
 *
 * @param {SerialPort} socket
 * @param {Function} callback
 */
async function read(socket, callback) {
  // read some data
  let ended = false;
  while (socket.readable && ended === false) {
    const reader = socket.readable.getReader();
    try {
      let loop = true;
      while (loop) {
        const { value, done } = await reader.read();

        if (done) {
          ended = true;
          break;
        }

        ended = await callback(value);

        if (ended) {
          break;
        }
      }
    } catch (error) {
      console.log("SerialPort read error", error);
    } finally {
      reader.releaseLock();
    }
  }
}
