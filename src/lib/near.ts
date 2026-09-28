import * as providers from "near-api-js/lib/providers";
import type { FinalExecutionOutcome } from "@near-wallet-selector/core";
import { DCL_CONTRACT_ID, POOL_RPC_URLS, REF_FINANCE_CONTRACT_ID, RPC_URLS, STORAGE_PRICE_PER_BYTE } from "../config/near";

/**
 * Read-only access to NEAR mainnet. Requests go to the primary RPC first and
 * fail over, in order, to the configured fallbacks when an endpoint is down
 * or rate limiting.
 */
function failover(urls: string[]) {
  return new providers.FailoverRpcProvider(
    urls.map((url) => new providers.JsonRpcProvider({ url }, { retries: 2, backoff: 1.5, wait: 250 })),
  );
}

/** Public RPC: token metadata, balances, accounts, transaction status. */
export const rpcProvider = failover(RPC_URLS);

/** Ref Finance and Rhea DCL reads (pools, deposits, shares, quotes): the keyed RPC via /api/rpc when configured. */
export const poolRpcProvider = POOL_RPC_URLS[0] === RPC_URLS[0] ? rpcProvider : failover(POOL_RPC_URLS);

export type ViewArgs = Record<string, unknown>;

/** Every endpoint failed at the network level (rate limited, down, timing out). */
export const isRpcBusy = (error: unknown) =>
  /Exceeded \d+ (providers|attempts)|RetriesExceeded|Too Many Requests|\b429\b/i.test(error instanceof Error ? error.message : String(error));

const RPC_RETRY_DELAYS_MS = [800, 2_000];

/**
 * Retry a read when every RPC endpoint is busy (rate limits clear within
 * seconds). Contract errors are thrown straight away.
 */
export async function withRpcRetry<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= RPC_RETRY_DELAYS_MS.length || !isRpcBusy(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RPC_RETRY_DELAYS_MS[attempt]));
    }
  }
}

/**
 * Execute a read-only (`call_function`) contract method and return its
 * JSON-decoded result. `null` results (e.g. an unregistered
 * `storage_balance_of`) are returned as `null`, not coerced.
 */
export async function viewMethod<T>(contractId: string, methodName: string, args: ViewArgs = {}): Promise<T> {
  const provider = contractId === REF_FINANCE_CONTRACT_ID || contractId === DCL_CONTRACT_ID ? poolRpcProvider : rpcProvider;
  const result = await withRpcRetry(() => provider.callFunction<Exclude<T, undefined> & object>(contractId, methodName, args));
  return (result === undefined ? null : result) as T;
}

export interface NativeBalance {
  /** Total liquid balance in yoctoNEAR (excludes staked/locked). */
  total: bigint;
  /** Balance reserved to pay for the account's own storage. */
  storageReserved: bigint;
  /** Spendable: total minus the storage the account must keep staked. */
  available: bigint;
}

export async function getNativeBalance(accountId: string): Promise<NativeBalance> {
  const account = await withRpcRetry(() => rpcProvider.viewAccount(accountId));
  const storageCost = BigInt(account.storage_usage) * STORAGE_PRICE_PER_BYTE;
  // Locked (staked) balance also counts toward covering storage.
  const storageReserved = storageCost > account.locked ? storageCost - account.locked : 0n;
  const available = account.amount > storageReserved ? account.amount - storageReserved : 0n;
  return { total: account.amount, storageReserved, available };
}

/* ------------------------------------------------ execution outcomes */

export class NearTransactionError extends Error {
  constructor(message: string, readonly txHash?: string) {
    super(message);
    this.name = "NearTransactionError";
  }
}

export function outcomeTxHash(outcome: FinalExecutionOutcome): string {
  const tx = outcome.transaction as { hash?: string } | undefined;
  return tx?.hash ?? outcome.transaction_outcome.id;
}

function describeFailure(failure: unknown): string {
  if (!failure) return "unknown failure";
  if (typeof failure === "string") return failure;
  const obj = failure as { error_message?: string; ActionError?: { kind?: unknown } };
  if (obj.error_message) return obj.error_message;
  // RPC ActionError shape: { ActionError: { index, kind: { FunctionCallError: { ExecutionError: "..." } } } }
  const kind = obj.ActionError?.kind as Record<string, unknown> | undefined;
  const fnError = kind?.FunctionCallError as Record<string, unknown> | undefined;
  if (fnError && typeof fnError.ExecutionError === "string") return fnError.ExecutionError;
  return JSON.stringify(failure);
}

/**
 * Return the first failure message across the transaction and all of its
 * receipts, or null when everything succeeded. A NEP-141 `ft_transfer_call`
 * whose receiver rejects the deposit still reports an overall success (the
 * tokens are refunded), so receipts must be inspected individually.
 */
export function findOutcomeFailure(outcome: FinalExecutionOutcome): string | null {
  const status = outcome.status;
  if (typeof status === "object" && status && "Failure" in status && status.Failure) {
    return describeFailure(status.Failure);
  }
  for (const receipt of outcome.receipts_outcome) {
    const s = receipt.outcome.status;
    if (typeof s === "object" && s && "Failure" in s && s.Failure) return describeFailure(s.Failure);
  }
  return null;
}

/** Decode a transaction's final `SuccessValue` (base64 JSON). */
export function outcomeReturnValue<T>(outcome: FinalExecutionOutcome): T | null {
  const status = outcome.status;
  if (typeof status !== "object" || !status || typeof status.SuccessValue !== "string" || !status.SuccessValue) return null;
  try {
    return JSON.parse(Buffer.from(status.SuccessValue, "base64").toString("utf8")) as T;
  } catch {
    return null;
  }
}

/* ------------------------------------------------ account ids */

const ACCOUNT_ID_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** NEAR account ID validity per the protocol spec (2–64 chars, lowercase). */
export function isValidAccountId(value: string): boolean {
  return value.length >= 2 && value.length <= 64 && ACCOUNT_ID_RE.test(value);
}
