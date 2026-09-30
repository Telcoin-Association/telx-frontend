import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "node:util";

// Jest's jsdom environment has no TextEncoder/TextDecoder, and viem needs them at import time.
// Node's encoder returns Node's Uint8Array, not the test environment's, which breaks `instanceof Uint8Array`
// and `toEqual(new Uint8Array(...))`, so copy the bytes into this environment's Uint8Array.
class TextEncoder extends NodeTextEncoder {
  encode(input?: string): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(super.encode(input));
  }
}

if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === "undefined") {
  globalThis.TextDecoder = NodeTextDecoder as typeof globalThis.TextDecoder;
}
