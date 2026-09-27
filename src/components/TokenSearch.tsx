import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { COMMON_TOKENS, WRAP_NEAR_CONTRACT_ID } from "../config/near";
import { useFtMetadata, usePool } from "../hooks/useRefData";
import { parseTokenInput, type ParsedInput } from "../lib/tokenInput";
import { displaySymbol } from "../lib/refFinance";
import { shortAccount } from "../lib/format";
import { TokenAvatar } from "./TokenAvatar";
import { Skeleton } from "./ui";
import { IconArrowRight, IconPaste, IconSearch, IconX } from "./icons";

export function routeFor(parsed: ParsedInput): string | null {
  if (parsed.kind === "token") return `/t/${parsed.tokenId}`;
  if (parsed.kind === "pool") return `/pool/${parsed.poolId}`;
  return null;
}

const resultClass =
  "mt-2 flex w-full items-center gap-3 rounded-2xl border border-line bg-card p-3 text-left transition hover:border-accent focus-visible:border-accent";

/** Resolved token behind a pasted address — click to open it. */
function TokenResult({ tokenId, onOpen }: { tokenId: string; onOpen: () => void }) {
  const meta = useFtMetadata(tokenId);
  if (meta.isError) {
    return (
      <div className="mt-2 rounded-2xl border border-line bg-card p-3 text-sm text-muted">
        <span className="font-mono text-ink">{shortAccount(tokenId, 40)}</span> isn't a token
      </div>
    );
  }
  return (
    <Link to={`/t/${tokenId}`} onClick={onOpen} className={resultClass} aria-busy={meta.isLoading}>
      <TokenAvatar tokenId={tokenId} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">
          {meta.data ? displaySymbol(tokenId, meta.data) : <Skeleton className="h-4 w-20" />}
          {meta.data?.name && <span className="ml-2 font-normal text-muted">{meta.data.name}</span>}
        </span>
        <span className="block truncate font-mono text-xs text-faint">{tokenId}</span>
      </span>
      <IconArrowRight size={18} className="shrink-0 text-muted" />
    </Link>
  );
}

function PoolResult({ poolId, onOpen }: { poolId: number; onOpen: () => void }) {
  const pool = usePool(poolId);
  const a = useFtMetadata(pool.data?.tokenIds[0]);
  const b = useFtMetadata(pool.data?.tokenIds[1]);
  if (pool.isError) return <div className="mt-2 rounded-2xl border border-line bg-card p-3 text-sm text-muted">Pool #{poolId} not found</div>;
  const ids = pool.data?.tokenIds ?? [];
  return (
    <Link to={`/pool/${poolId}`} onClick={onOpen} className={resultClass}>
      <span className="flex shrink-0 -space-x-2">
        {ids.slice(0, 2).map((id) => <TokenAvatar key={id} tokenId={id} size={32} className="ring-2 ring-card" />)}
        {ids.length === 0 && <Skeleton className="h-8 w-8 rounded-full" />}
      </span>
      <span className="min-w-0 flex-1 truncate font-semibold text-ink">
        {ids.length ? `${displaySymbol(ids[0], a.data)} / ${displaySymbol(ids[1] ?? "", b.data)}` : "…"}
        <span className="ml-2 font-normal text-muted">#{poolId}</span>
      </span>
      <IconArrowRight size={18} className="shrink-0 text-muted" />
    </Link>
  );
}

/**
 * Main entry point: paste a token contract (or pool ID / nearblocks or Ref
 * link), see what it resolves to, then click it (or press Enter) to open.
 */
export function TokenSearch({ autoFocus = false, size = "lg" }: { autoFocus?: boolean; size?: "lg" | "md" }) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const parsed = parseTokenInput(value);
  const invalid = parsed.kind === "invalid";
  const clear = () => setValue("");

  const pasteFromClipboard = async () => {
    try {
      setValue((await navigator.clipboard.readText()).trim());
    } catch {
      /* clipboard permission denied — the user can still paste manually */
    }
  };

  const big = size === "lg";
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const route = routeFor(parsed);
          if (route) {
            navigate(route);
            clear();
          }
        }}
        className={`flex items-center gap-2 rounded-2xl border bg-card px-3 transition focus-within:border-accent ${
          invalid ? "border-danger/60" : "border-line"
        } ${big ? "h-16" : "h-12"}`}
      >
        <IconSearch size={big ? 20 : 17} className="shrink-0 text-faint" />
        <input
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste token address"
          aria-label="Token contract address or pool ID"
          aria-invalid={invalid}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          className={`w-full min-w-0 bg-transparent font-mono text-ink outline-none placeholder:font-body placeholder:text-faint ${big ? "text-base" : "text-sm"}`}
        />
        {value ? (
          <button type="button" onClick={clear} aria-label="Clear" className="rounded-lg p-2 text-faint hover:bg-card2 hover:text-ink">
            <IconX size={15} />
          </button>
        ) : (
          <button
            type="button"
            onClick={pasteFromClipboard}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-card2 px-3 text-sm font-medium text-muted transition hover:text-ink"
          >
            <IconPaste size={15} /> Paste
          </button>
        )}
      </form>
      {invalid && <p className="mt-2 px-1 text-xs text-danger">Not a NEAR account ID or pool ID.</p>}
      {parsed.kind === "token" && <TokenResult tokenId={parsed.tokenId} onOpen={clear} />}
      {parsed.kind === "pool" && <PoolResult poolId={parsed.poolId} onOpen={clear} />}
    </div>
  );
}

/** One-tap shortcuts to popular tokens. */
export function QuickTokens() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {COMMON_TOKENS.filter((t) => t.id !== WRAP_NEAR_CONTRACT_ID).map((t) => (
        <button
          key={t.id}
          onClick={() => navigate(`/t/${t.id}`)}
          className="flex h-9 items-center gap-2 rounded-full border border-line bg-card pr-3.5 pl-1.5 text-sm font-medium text-ink transition hover:border-faint"
        >
          <TokenAvatar tokenId={t.id} size={24} />
          {t.symbol}
        </button>
      ))}
    </div>
  );
}
