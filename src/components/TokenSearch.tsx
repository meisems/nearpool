import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { COMMON_TOKENS, WRAP_NEAR_CONTRACT_ID } from "../config/near";
import { parseTokenInput, type ParsedInput } from "../lib/tokenInput";
import { TokenAvatar } from "./TokenAvatar";
import { IconArrowRight, IconPaste, IconSearch } from "./icons";

export function routeFor(parsed: ParsedInput): string | null {
  if (parsed.kind === "token") return `/t/${parsed.tokenId}`;
  if (parsed.kind === "pool") return `/pool/${parsed.poolId}`;
  return null;
}

/**
 * The main entry point: paste a token contract (or pool ID / nearblocks or
 * Ref link) and go straight to its liquidity page.
 */
export function TokenSearch({ autoFocus = false, size = "lg" }: { autoFocus?: boolean; size?: "lg" | "md" }) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const parsed = parseTokenInput(value);
  const invalid = parsed.kind === "invalid";

  const go = (raw = value) => {
    const route = routeFor(parseTokenInput(raw));
    if (route) {
      navigate(route);
      setValue("");
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setValue(text);
      go(text);
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
          go();
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
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (routeFor(parseTokenInput(text))) {
              e.preventDefault();
              go(text);
            }
          }}
          placeholder="Paste token address"
          aria-label="Token contract address or pool ID"
          aria-invalid={invalid}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          className={`w-full min-w-0 bg-transparent font-mono text-ink outline-none placeholder:font-body placeholder:text-faint ${big ? "text-base" : "text-sm"}`}
        />
        {value ? (
          <button
            type="submit"
            disabled={!routeFor(parsed)}
            aria-label="Open token"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accentfill text-onaccent transition disabled:bg-card2 disabled:text-faint"
          >
            <IconArrowRight size={17} />
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
    </div>
  );
}

/** One-tap shortcuts to popular tokens. */
export function QuickTokens() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap gap-2">
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
