import { createPublicClient, http } from "viem";
import { robinhoodChain } from "./wagmi";

/**
 * Read-only client against the REAL Robinhood Chain public RPC — used only
 * to resolve raw ERC-20 metadata (name / symbol / decimals) for display in
 * the token picker, the same way a block explorer or Uniswap itself does.
 *
 * Important: this is a plain contract read. It is NOT curation, NOT a
 * verification step, and NOT an endorsement — any contract, legitimate or
 * not, can set name()/symbol() to whatever it wants.
 */
export const liveClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(robinhoodChain.rpcUrls.default.http[0]),
});
