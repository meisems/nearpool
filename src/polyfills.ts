/**
 * near-api-js / @near-js/* reference the Node `Buffer` global when encoding
 * view-call args and decoding results. Browsers don't ship it, so install
 * the `buffer` package's implementation before any NEAR module loads.
 * Imported first thing in main.tsx.
 */
import { Buffer } from "buffer";

const scope = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (!scope.Buffer) scope.Buffer = Buffer;
