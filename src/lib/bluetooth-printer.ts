/**
 * Sends bytes straight to a Bluetooth thermal printer from the browser.
 *
 * The point is what it removes. Printing from a phone used to go through
 * Android's print dialog into RawBT, and the free build of RawBT prints its own
 * advertising line onto every slip a customer is handed. That line is added
 * after our page is out of the picture, so no amount of CSS could take it off.
 * Here the browser holds the connection itself: what we send is what prints.
 *
 * Web Bluetooth speaks BLE only, so a printer that offers nothing but Classic
 * SPP will not appear in the chooser. Most 58mm counter printers sold in the
 * last few years do BLE; the older ones do not, and for those the answer is a
 * different printer or the paid app. Chrome or Edge on Android; iOS has no Web
 * Bluetooth at all.
 */

/** Serial-over-BLE services these printers are actually found behind. */
const PRINTER_SERVICES = [
  0x18f0, // by far the most common on cheap 58mm hardware
  0xff00,
  0xffe0,
  0xff80,
  0xfff0,
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", // Issc / Microchip transparent UART
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e", // Nordic UART
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
] as const;

/**
 * Payload per write.
 *
 * A default BLE connection carries 20 bytes per packet and many of these
 * printers never negotiate higher. Sending more than the link allows does not
 * error — it truncates, which shows up as a receipt missing its last few lines.
 */
const CHUNK = 20;
/** Printers buffer far less than a phone can send; without this they drop bytes. */
const CHUNK_PAUSE_MS = 20;

export interface PrinterConnection {
  name: string;
  write(data: Uint8Array): Promise<void>;
  disconnect(): void;
  connected(): boolean;
}

/** Kept for the session so a second receipt does not re-open the chooser. */
let current: PrinterConnection | null = null;

export function isSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

export function connectedPrinter(): PrinterConnection | null {
  return current?.connected() ? current : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Opens the browser's device chooser and connects to whatever is picked.
 *
 * Must be called from a real click: Chrome refuses the chooser otherwise.
 */
export async function choosePrinter(): Promise<PrinterConnection> {
  const bluetooth = typeof navigator === "undefined" ? undefined : navigator.bluetooth;
  if (!bluetooth)
    throw new Error(
      "This browser cannot talk to Bluetooth devices. Use Chrome on Android — " +
        "iPhones and iPads have no Web Bluetooth at all."
    );

  /*
   * acceptAllDevices, rather than filtering by service.
   *
   * These printers advertise under a dozen different names (POS58, MPT-II,
   * BlueTooth Printer…) and often do not advertise their service UUID at all,
   * so a filtered chooser comes up empty and looks broken. Showing everything
   * and letting the operator pick their printer by name is the honest version.
   */
  const device = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: PRINTER_SERVICES as unknown as BluetoothServiceUUID[],
  });

  const server = await device.gatt!.connect();

  // Find the first characteristic anywhere on the device that accepts writes.
  // Which service it lives under varies by manufacturer, so it is discovered
  // rather than assumed.
  let target: BluetoothRemoteGATTCharacteristic | null = null;
  for (const service of await server.getPrimaryServices()) {
    for (const ch of await service.getCharacteristics()) {
      if (ch.properties.write || ch.properties.writeWithoutResponse) {
        target = ch;
        break;
      }
    }
    if (target) break;
  }
  if (!target) {
    server.disconnect();
    throw new Error(
      `${device.name ?? "That device"} has no writable channel — it is probably not a printer, ` +
        "or it only supports older Classic Bluetooth, which browsers cannot reach."
    );
  }

  const ch = target;
  // writeWithoutResponse is dramatically faster and is what these printers
  // expect; the acknowledged form is the fallback for the ones that insist.
  const noResponse = ch.properties.writeWithoutResponse;

  const conn: PrinterConnection = {
    name: device.name ?? "Bluetooth printer",
    connected: () => !!device.gatt?.connected,
    disconnect: () => device.gatt?.disconnect(),
    async write(data) {
      for (let i = 0; i < data.length; i += CHUNK) {
        const slice = data.slice(i, i + CHUNK);
        if (noResponse) await ch.writeValueWithoutResponse(slice);
        else await ch.writeValueWithResponse(slice);
        await sleep(CHUNK_PAUSE_MS);
      }
    },
  };

  device.addEventListener("gattserverdisconnected", () => {
    if (current === conn) current = null;
  });

  current = conn;
  return conn;
}

/**
 * Prints, reusing the open connection when there is one.
 *
 * Reconnecting on every receipt would put the chooser in front of the cashier
 * for each order, which is exactly the friction this is meant to remove.
 */
export async function printBytes(data: Uint8Array): Promise<string> {
  const conn = connectedPrinter() ?? (await choosePrinter());
  await conn.write(data);
  return conn.name;
}
