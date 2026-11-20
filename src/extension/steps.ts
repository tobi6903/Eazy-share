// The instructions shown for the receiving device. Plain data, no DOM, so it is easy to edit.

export interface Step {
  title: string;
  detail: string;
}

export interface Faq {
  q: string;
  a: string;
}

const PLACEHOLDER = 'the address shown above';

/** Steps to follow on the phone/laptop that should receive files. */
export function receiverSteps(url: string | null): Step[] {
  const address = url ?? PLACEHOLDER;
  return [
    {
      title: 'Join the same Wi-Fi',
      detail: 'Connect the receiving device to the same Wi-Fi or network as this computer.',
    },
    {
      title: 'Open the address in a browser',
      detail: `Type ${address} into the browser's address bar (include http:// and the port number).`,
    },
    {
      title: 'Check you are online',
      detail: 'A green dot appears next to "You are …" with a device name. Tap the name to change it.',
    },
    {
      title: 'Ask the sender to pick your device',
      detail:
        'On this computer, open the sharing page, choose files or a folder, tick the receiving device, and press "Zip & send".',
    },
    {
      title: 'Download the zip',
      detail:
        'A "New file" notice appears on the receiving device. Under "Received", tap Download, then open the .zip to extract it.',
    },
  ];
}

/** Things that commonly go wrong. */
export function troubleshooting(): Faq[] {
  return [
    {
      q: "The receiving device can't open the address",
      a: 'Make sure both devices are on the same Wi-Fi. Guest or public networks often block devices from reaching each other; try a home network or a phone hotspot.',
    },
    {
      q: 'A firewall prompt appeared on this computer',
      a: 'macOS or Windows may ask whether Node.js can accept incoming connections. Choose Allow (on Windows, tick "Private networks"). Without it, other devices cannot reach this computer.',
    },
    {
      q: "I can't pick a folder on my phone or tablet",
      a: 'Phone and tablet browsers can only pick files. To send a whole folder, send from a computer; phones can still receive it as a zip.',
    },
    {
      q: 'The dot stays grey',
      a: 'Reload the page on the receiving device. If this computer switched networks, stop and start sharing to get a new address.',
    },
    {
      q: 'The device list is empty',
      a: 'The other device must have the page open (and awake). Devices disappear a few seconds after the page is closed.',
    },
  ];
}
