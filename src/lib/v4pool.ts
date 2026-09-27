import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { V4_APPROVED_HOOKS, ZERO_ADDRESS } from "../config/contracts";

/**
 * Uniswap V4 has no per-pair contract — every pool is a row of state inside
 * the singleton PoolManager, keyed by a PoolId derived from its PoolKey.
 * Existence, price, and liquidity are read via `extsload` on the raw
 * storage slot, the same technique Uniswap's own StateLibrary.sol uses
 * (see https://docs.uniswap.org/contracts/v4/reference/core/libraries/StateLibrary).
 * This layout is part of v4-core's storage layout, not a per-chain deploy
 * detail, so it's safe to hardcode regardless of which chain PoolManager
 * lives on.
 */

export interface PoolKeyV4 {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

/** index of the `pools` mapping in PoolManager's storage layout. */
const POOLS_SLOT = 6n;
/** index of `liquidity` within Pool.State (feeGrowth globals sit at 1 and 2). */
const LIQUIDITY_OFFSET = 3n;

const toBytes32 = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`;
export const ZERO_BYTES32: Hex = toBytes32(0n);

/**
 * ponspool pairs native ETH against a creator token and uses the configured
 * approved hook. Native ETH (address(0)) always sorts below any ERC-20, so
 * currency0 is fixed here.
 */
export function buildNativePoolKey(token: `0x${string}`, feeTier: number, tickSpacing: number, hooks: `0x${string}` = V4_APPROVED_HOOKS): PoolKeyV4 {
  return {
    currency0: ZERO_ADDRESS as `0x${string}`,
    currency1: token,
    fee: feeTier,
    tickSpacing,
    hooks,
  };
}

/** PoolId = keccak256(abi.encode(PoolKey)). */
export function computePoolId(key: PoolKeyV4): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

/** slot of `pools[poolId]` (the start of that pool's Pool.State struct). */
function poolStateSlot(poolId: Hex): Hex {
  return keccak256(`${poolId}${toBytes32(POOLS_SLOT).slice(2)}` as Hex);
}

/** slot0 packs sqrtPriceX96 (160b) | tick (24b) | protocolFee (24b) | lpFee (24b). */
export function slot0Slot(poolId: Hex): Hex {
  return poolStateSlot(poolId);
}

/** liquidity is a plain uint128 field at state_slot + LIQUIDITY_OFFSET. */
export function liquiditySlot(poolId: Hex): Hex {
  const state = BigInt(poolStateSlot(poolId));
  return toBytes32(state + LIQUIDITY_OFFSET);
}

export interface Slot0 {
  sqrtPriceX96: bigint;
  tick: number;
  protocolFee: number;
  lpFee: number;
}

/** Unpacks the raw extsload(slot0Slot) word. sqrtPriceX96 === 0n means the pool was never initialized. */
export function parseSlot0(data: Hex | undefined): Slot0 {
  if (!data) return { sqrtPriceX96: 0n, tick: 0, protocolFee: 0, lpFee: 0 };
  const word = BigInt(data);
  const sqrtPriceX96 = word & ((1n << 160n) - 1n);
  let tickRaw = (word >> 160n) & 0xffffffn;
  if (tickRaw & 0x800000n) tickRaw -= 0x1000000n; // sign-extend int24
  const protocolFee = Number((word >> 184n) & 0xffffffn);
  const lpFee = Number((word >> 208n) & 0xffffffn);
  return { sqrtPriceX96, tick: Number(tickRaw), protocolFee, lpFee };
}

export function parseLiquidity(data: Hex | undefined): bigint {
  if (!data) return 0n;
  return BigInt(data) & ((1n << 128n) - 1n);
}

const Q96 = 2n ** 96n;

/**
 * Virtual reserves at the current tick — the standard concentrated-liquidity
 * approximation (x = L / sqrtP, y = L * sqrtP) used for a spot-price ratio
 * and a rough local price-impact estimate. Only valid near the current
 * price; it is NOT a substitute for a real quote across ticks.
 */
export function virtualReserves(sqrtPriceX96: bigint, liquidity: bigint): { reserve0: bigint; reserve1: bigint } {
  if (sqrtPriceX96 <= 0n || liquidity <= 0n) return { reserve0: 0n, reserve1: 0n };
  const reserve0 = (liquidity * Q96) / sqrtPriceX96;
  const reserve1 = (liquidity * sqrtPriceX96) / Q96;
  return { reserve0, reserve1 };
}

/** PositionManager action identifiers from v4-periphery. */
export const V4_ACTIONS = {
  INITIALIZE_POOL: 0x01,
  MINT_POSITION: 0x02,
  SETTLE_PAIR: 0x0d,
} as const;

/**
 * Encodes the `unlockData` consumed by PositionManager.modifyLiquidities.
 * The outer payload is abi.encode(bytes actions, bytes[] params); each params
 * entry is ABI encoded independently, matching v4-periphery's ActionsParser.
 */
export function encodeModifyLiquiditiesPayload(args: {
  key: PoolKeyV4;
  tickLower: number;
  tickUpper: number;
  liquidityDelta: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  salt: Hex;
    hookData?: Hex;
    recipient: `0x${string}`;
    initializePool?: boolean;
    initialSqrtPriceX96?: bigint;
}): Hex {
  const initialize = args.initializePool === true;
  const actions = `0x${initialize ? V4_ACTIONS.INITIALIZE_POOL.toString(16).padStart(2, "0") : ""}${V4_ACTIONS.MINT_POSITION.toString(16).padStart(2, "0")}${V4_ACTIONS.SETTLE_PAIR.toString(16).padStart(2, "0")}` as Hex;
  const initializeParams = initialize ? encodeAbiParameters(
    [{ type: "tuple", components: [
      { name: "currency0", type: "address" }, { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
    ] }, { type: "uint160" }],
    [args.key, args.initialSqrtPriceX96 ?? (2n ** 96n)],
  ) : undefined;
  const mintParams = encodeAbiParameters(
    [{ type: "tuple", components: [
      { name: "poolKey", type: "tuple", components: [
        { name: "currency0", type: "address" }, { name: "currency1", type: "address" },
        { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
      ] },
      { name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint256" }, { name: "amount0Max", type: "uint128" },
      { name: "amount1Max", type: "uint128" }, { name: "owner", type: "address" },
      { name: "hookData", type: "bytes" },
    ] }],
    [{ poolKey: args.key, tickLower: args.tickLower, tickUpper: args.tickUpper,
      liquidity: args.liquidityDelta, amount0Max: args.amount0Max, amount1Max: args.amount1Max,
      owner: args.recipient, hookData: args.hookData ?? "0x" }],
  );
  const settlePairParams = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }],
    [args.key.currency0, args.key.currency1],
  );
  return encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, initialize ? [initializeParams!, mintParams, settlePairParams] : [mintParams, settlePairParams]]) as Hex;
}
