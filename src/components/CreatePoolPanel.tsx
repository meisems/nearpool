import { useState } from "react";
import { Link } from "react-router-dom";
import { useNearWallet } from "../context/NearWalletContext";
import { useCreatePool } from "../hooks/useCreatePool";
import { useFtMetadata, useNativeBalance, usePlatformFee, useTokenPools } from "../hooks/useRefData";
import { NEAR_DECIMALS, NEAR_GAS_RESERVE, POOL_CREATION_DEPOSIT, WRAP_NEAR_CONTRACT_ID } from "../config/near";
import { counterToken, displaySymbol, POOL_FEE_TIERS } from "../lib/refFinance";
import { fmtAmount } from "../lib/format";
import { useToast } from "./Toasts";
import { TokenAvatar } from "./TokenAvatar";
import { TokenSelectModal } from "./TokenSelectModal";
import { Button, Card } from "./ui";
import { IconAlert, IconChevronDown, IconPlus } from "./icons";

/**
 * Create a Ref simple pool for `tokenId` against a chosen counter token.
 * The pool starts empty; `onCreated` receives its ID so the caller can open
 * it and add the first liquidity (which sets the price).
 */
export function CreatePoolPanel({ tokenId, onCreated, onCancel }: { tokenId: string; onCreated: (poolId: number) => void; onCancel?: () => void }) {
  const { accountId, signIn } = useNearWallet();
  const toast = useToast();
  const [counterId, setCounterId] = useState(WRAP_NEAR_CONTRACT_ID);
  const [feeBps, setFeeBps] = useState<number>(30);
  const [picker, setPicker] = useState(false);

  const meta = useFtMetadata(tokenId);
  const counterMeta = useFtMetadata(counterId);
  const pools = useTokenPools(tokenId);
  const native = useNativeBalance();
  const feeQ = usePlatformFee();
  const create = useCreatePool();

  const symbol = displaySymbol(tokenId, meta.data);
  const counterSymbol = displaySymbol(counterId, counterMeta.data);
  const samePair = (pools.data ?? []).filter((p) => counterToken(p, tokenId) === counterId);
  const sameFee = samePair.find((p) => p.totalFeeBps === feeBps);
  const cost = POOL_CREATION_DEPOSIT + (feeQ.data?.amount ?? 0n);
  const short = native.data !== undefined && native.data.available < cost + NEAR_GAS_RESERVE;

  const submit = async () => {
    const poolId = await create.run([tokenId, counterId], feeBps);
    if (poolId !== null) {
      toast(`Pool #${poolId} created — add the first liquidity`, "ok");
      onCreated(poolId);
    }
  };

  const cta = !accountId
    ? { label: "Connect wallet", disabled: false, onClick: signIn }
    : create.busy
      ? { label: create.phase === "signing" ? "Confirm in wallet" : "Checking…", disabled: true, onClick: undefined }
      : !meta.data || !counterMeta.data
        ? { label: "Loading…", disabled: true, onClick: undefined }
        : short
          ? { label: "Not enough NEAR", disabled: true, onClick: undefined }
          : { label: "Create pool", disabled: false, onClick: () => void submit() };

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">Create pool</h2>
        {onCancel && (
          <button onClick={onCancel} className="text-sm text-muted hover:text-ink">
            Cancel
          </button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-xl bg-card2 p-2">
        <span className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-card px-2.5 py-2 text-sm font-semibold text-ink">
          <TokenAvatar tokenId={tokenId} size={22} />
          <span className="truncate">{symbol}</span>
        </span>
        <IconPlus size={14} className="shrink-0 text-faint" />
        <button
          onClick={() => setPicker(true)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-card px-2.5 py-2 text-sm font-semibold text-ink transition hover:bg-line"
        >
          <TokenAvatar tokenId={counterId} size={22} />
          <span className="truncate">{counterSymbol}</span>
          <IconChevronDown size={12} className="ml-auto shrink-0 text-faint" />
        </button>
      </div>

      <div className="mt-3">
        <div className="text-xs text-muted">Swap fee</div>
        <div className="mt-1.5 grid grid-cols-4 gap-1">
          {POOL_FEE_TIERS.map((bps) => (
            <button
              key={bps}
              onClick={() => setFeeBps(bps)}
              className={`h-9 rounded-lg text-sm font-semibold ${feeBps === bps ? "bg-accentsoft text-accentstrong" : "bg-card2 text-muted hover:text-ink"}`}
            >
              {bps / 100}%
            </button>
          ))}
        </div>
      </div>

      {samePair.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-amberish">
          <IconAlert size={13} className="mt-px shrink-0" />
          <span>
            {sameFee ? "This pool already exists: " : "Existing pools for this pair: "}
            {samePair.slice(0, 3).map((p, i) => (
              <span key={p.id}>
                {i > 0 && ", "}
                <Link to={`/t/${tokenId}?pool=${p.id}`} className="underline">#{p.id}</Link>
              </span>
            ))}
          </span>
        </p>
      )}

      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted" title="Pays for the pool's on-chain storage; the unused part is refunded">Storage deposit</dt>
          <dd className="text-ink tabular">≤ {fmtAmount(POOL_CREATION_DEPOSIT, NEAR_DECIMALS)} NEAR</dd>
        </div>
        {feeQ.data && (
          <div className="flex justify-between">
            <dt className="text-muted">Fee</dt>
            <dd className="text-ink tabular">{fmtAmount(feeQ.data.amount, NEAR_DECIMALS)} NEAR</dd>
          </div>
        )}
      </dl>

      {create.phase === "error" && create.error && <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{create.error}</p>}

      <Button size="lg" className="mt-4 w-full" disabled={cta.disabled} loading={create.busy} onClick={cta.onClick}>
        {cta.label}
      </Button>

      <TokenSelectModal open={picker} onClose={() => setPicker(false)} excludeTokenId={tokenId} onSelect={setCounterId} />
    </Card>
  );
}
