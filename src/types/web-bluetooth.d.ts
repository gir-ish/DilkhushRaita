/**
 * Minimal Web Bluetooth declarations.
 *
 * TypeScript's DOM library does not describe this API, and the published
 * @types/web-bluetooth package is a large surface for the handful of calls
 * src/lib/bluetooth-printer.ts actually makes. Only what is used is declared
 * here, so anything beyond it still fails to compile rather than being waved
 * through as `any`.
 */

type BluetoothServiceUUID = number | string;

interface BluetoothRemoteGATTCharacteristic {
  readonly properties: {
    readonly write: boolean;
    readonly writeWithoutResponse: boolean;
  };
  writeValueWithResponse(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
}

interface BluetoothRemoteGATTService {
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothRemoteGATTServer {
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothDevice extends EventTarget {
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
}

interface Bluetooth {
  requestDevice(options: {
    acceptAllDevices?: boolean;
    filters?: { services?: BluetoothServiceUUID[]; namePrefix?: string }[];
    optionalServices?: BluetoothServiceUUID[];
  }): Promise<BluetoothDevice>;
}

interface Navigator {
  readonly bluetooth?: Bluetooth;
}
