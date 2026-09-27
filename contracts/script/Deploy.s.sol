// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {PonspoolRouter} from "../PonspoolRouter.sol";

/**
 * Foundry deployment script for Robinhood Chain (4663).
 *
 *   forge script script/Deploy.s.sol:DeployPonspoolRouter \
 *     --rpc-url https://rpc.mainnet.chain.robinhood.com \
 *     --broadcast --verify
 *
 * Addresses resolve from environment variables with the canonical
 * Robinhood Chain deployments as fallbacks.
 */
contract DeployPonspoolRouter is Script {
    function run() external {
        address platformToken = vm.envAddress("PLATFORM_TOKEN");
        uint256 requiredHold = vm.envOr("REQUIRED_HOLD", uint256(500_000e18));
        address weth = vm.envAddress("WETH");
        address v3PosMgr = vm.envAddress("V3_POS_MGR");
        address v4PoolMgr = vm.envAddress("V4_POOL_MGR");
        address v4PosMgr = vm.envAddress("V4_POS_MGR");
        address permit2 = vm.envAddress("PERMIT2");
        address approvedHooks = vm.envAddress("APPROVED_HOOKS");

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        PonspoolRouter router = new PonspoolRouter(
            platformToken,
            requiredHold,
            weth,
            v3PosMgr,
            v4PoolMgr,
            v4PosMgr,
            permit2,
            approvedHooks
        );

        // Buyback pool key is intentionally NOT set here — the launchpad
        // seeds the native-ETH/platform-token V4 pool as part of the token
        // launch, and its fee tier/tickSpacing/hooks aren't known until
        // that happens. Call setBuybackPool() once that pool exists;
        // until then the router charges non-holders no fee at all.

        vm.stopBroadcast();

        console.log("PonspoolRouter deployed at:", address(router));
        console.log("platformToken:", platformToken);
        console.log("requiredHold:", requiredHold);
        console.log("v4PoolMgr:", v4PoolMgr);
    }
}
