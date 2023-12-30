import save from './save.js';
import Xmodem from './xmodem.js';

/**
 *
 * @param {string} s
 * @returns HTMLElement
 */
const $ = (s) => document.querySelector(s);

/** @type {Xmodem} */
let modem;

const transferred = $('#transferred');
const log = $('#log');
const $receive = $('#receive');
const $send = $('#send');
const $connect = $('#connect');
const $baud = $('input[name="baud"]');

$receive.addEventListener('click', async () => {
  const reply = await modem.receive();
  const filename = prompt('Filename?');
  save(reply, filename);
});

$send.addEventListener('input', async (event) => {
  const file = event.target.files[0];
  const reader = new FileReader();

  reader.onloadend = function (e) {
    modem.send(Array.from(new Uint8Array(e.target.result)));
  };

  reader.readAsArrayBuffer(file);
});

$connect.addEventListener('click', async () => {
  // const usbVendorId = 0xabcd;
  navigator.serial
    .requestPort()
    .then((port) => {
      // Connect to `port` or add it to the list of available ports.

      let baudRate = parseInt($baud.value || '38400', 10);

      modem = new Xmodem(port, baudRate);
      modem.on('log', (report) => {
        log.innerHTML =
          `<code><time>${new Date()
            .toJSON()
            .split('T')
            .pop()}</time>: ${report}</code>\n` +
          log.innerHTML.split('\n').slice(0, 5).join('\n');
      });
      modem.on('status', (amount) => (transferred.textContent = amount));

      $connect.parentElement.hidden = true;
      const parent = $send.closest('div');
      parent.removeAttribute('disabled');
      parent.removeAttribute('aria-disabled');
    })
    .catch((e) => {
      console.log('open failed', e);
      // The user didn't select a port.
    });
});

// async function sendInit() {
//   const req = await fetch("./ws-backup-tool-v0.1.8.bfb");
//   const res = await req.arrayBuffer();
//   modem.send(Array.from(new Uint8Array(res)));
// }
