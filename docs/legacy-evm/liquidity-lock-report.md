# Creator Liquidity Destination Report

## Implemented behavior

Creators can now choose **lock forever** or **burn position** in the CreatorTerminal before minting liquidity. The choice is threaded through the injection parameters. V4 raw `modifyLiquidities` payloads encode the selected recipient, and the Solidity router executes the supplied raw unlock payload. Legacy V3 V1 tokens use the configured V3 position manager and receive the same destination selection.

The permanent-lock destination defaults to the documented Robinhood V4 locker address `0x128A800cBc615cc110Bff16E475865c67631603A`, but it is configurable with `VITE_V4_PERMANENT_LOCKER`. The burn destination is the unrecoverable `0x000000000000000000000000000000000000dEaD`. The UI explicitly warns that burning cannot be undone.

## Important deployment condition

A locker address by itself does not prove that it supports a permanent lock. Before production use, verify that the configured locker is deployed on Robinhood Chain, accepts the relevant V4/V3 position token, and enforces an actual non-withdrawable or forever-lock state. The current repository did not include a locker ABI or an authoritative PonsFamily V1 token list, so the implementation uses an explicit configurable destination and does not pretend to know an undocumented locker method.

The supplied references support this design: Uniswap documents V3 positions as ERC-721 NFTs and V4 positions as PositionManager-managed positions; therefore locking or burning must address position ownership rather than fungible LP shares. The UNCX reference documents a Robinhood V4 locker and describes custody in a contract with withdrawal restrictions. The Uniswap issue also shows why a clear irreversible burn choice is preferable to silently sending an NFT to an arbitrary address.

## Validation

`npm run build` completed successfully. Solidity compilation was not run because Foundry is not installed in the sandbox.

## References

[1]: https://github.com/Uniswap/interface/issues/5189 "Uniswap interface issue #5189"
[2]: https://developers.uniswap.org/docs/get-started/concepts/how-uniswap-works "How Uniswap Works"
[3]: https://github.com/Uniswap/v4-periphery/blob/main/src/PositionManager.sol "Uniswap V4 PositionManager"
[4]: https://updraft.cyfrin.io/courses/uniswap-v4/position-manager/position-manager "Cyfrin Uniswap V4 PositionManager lesson"
[5]: https://docs.uncx.network/guides/for-projects/liquidity-lockers-v4 "UNCX Liquidity Lockers V4"
[6]: https://arbiscan.io/nft/0xd88f38f930b7952f2db2432cb002e7abbf3dd869/37340 "Arbiscan Uniswap V4 position NFT #37340"
[7]: https://unicrypt.medium.com/uniswap-v3-liquidity-locking-explained-979b5a5503de "UNCX Uniswap V3 Liquidity Locking Explained"
