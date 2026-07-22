import { NimClient } from './NimClient.js';

/** One-line dispatcher so a second backend can be added later without touching call sites. */
export function createLLMClient(config) {
  return new NimClient(config.nim);
}
