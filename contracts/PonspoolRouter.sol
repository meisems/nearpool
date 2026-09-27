// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * PonspoolRouter — ponspool liquidity engine on Robinhood Chain (4663).
 *
 * Uniswap V4 only, zero custody, end to end:
 *   - V4  injectV4 / zapEthV4     (PositionManager over the PoolManager singleton)
 *   - V4  buyback-and-burn        (direct PoolManager swap, see _handleFeeAndBurn)
 *
 * Fee model — enforced on-chain, not in the UI:
 *   holders of `requiredHoldAmount` platform token pay nothing (isHolder);
 *   everyone else pays feeBps (70–120 bps), which the router instantly
 *   market-buys into platform token and burns to 0x...dEaD inside the same
 *   transaction. The swap settles against `buybackPoolKey` — the native
 *   ETH / platform-token V4 pool seeded by the ponsfamily launchpad — via
 *   the PoolManager's unlock/settle/take pattern. No treasury custody hop
 *   on the hot path, and no V2 pair anywhere in the flow.
 *
 * NOTE: buybackPoolKey must be pointed at the real launchpad pool with
 * setBuybackPool() before any non-holder traffic hits the router, or the
 * router charges no fee at all (see _handleFeeAndBurn) rather than collect
 * ETH it has nowhere to route.
 */

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @dev Uniswap v4 PoolKey (singleton architecture — every pool is a row of
/// state inside PoolManager, keyed by keccak256(abi.encode(PoolKey))).
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

interface IPositionManagerV4 {
    struct ModifyLiquidityParams {
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
        bytes32 salt;
    }
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
}

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface IPositionManagerV3 {
    struct MintParams {
        address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper;
        uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min;
        address recipient; uint256 deadline;
    }
    function mint(MintParams calldata params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

/// @dev Minimal PoolManager surface for a direct, self-custodied swap.
/// The returned delta is v4-core's packed int256 (amount0 in the high 128
/// bits, amount1 in the low 128 bits) — see v4-core's BalanceDelta.sol.
interface IPoolManagerV4 {
    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256 delta);
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
    function initialize(PoolKey calldata key, uint160 sqrtPriceX96) external returns (int24 tick);
}

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IUnlockCallback {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

contract PonspoolRouter is IUnlockCallback {
    /* ----------------------------------------------------- immutables ---- */

    /// @notice Platform token used for holder gating and buyback burns.
    /// Can be unset at deployment and configured once the real token launches.
    address public platformToken;
    bool public platformTokenSet;
    uint256 public immutable requiredHoldAmount;
    /// @dev Marks the native-ETH leg when detecting the paired token in
    /// injectV4/zapEthV4. ponspool pools always sort native ETH (address(0))
    /// as currency0, but some external pools may wrap it — kept for that case.
    address public immutable weth;
    address public immutable v4PoolManager;
    address public immutable v4PositionManager;
    address public immutable v3PositionManager;
    address public immutable permit2;
    address public immutable approvedHooks;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    /// TickMath bounds, inclusive-exclusive, used as swap price limits so the
    /// buyback never reverts on price-limit alone (an unfavorable fill still
    /// lands in DEAD, so it's protocol-neutral rather than a user loss).
    uint160 internal constant MIN_SQRT_PRICE_LIMIT = 4295128740; // TickMath.MIN_SQRT_PRICE + 1
    uint160 internal constant MAX_SQRT_PRICE_LIMIT = 1461446703485210103287273052203988822378723970341; // TickMath.MAX_SQRT_PRICE - 1

    /// Non-holder protocol cut in bps. Bounded [70, 120] — 0.7% to 1.2%.
    uint256 public feeBps = 100;

    /// The native-ETH / platform-token V4 pool the buyback swap settles against.
    PoolKey public buybackPoolKey;
    bool public buybackPoolSet;
    uint256 public buybackMinOutPerEth;

    address public owner;
    address public pendingOwner;

    /* ------------------------------------------------------- events ------ */

    event PlatformCut(address indexed payer, uint256 ethSpent, uint256 ponsIncinerated);
    event DualInjected(
        uint8 indexed version, address indexed token, address indexed recipient,
        uint256 ethIn, uint256 tokenIn, uint256 liquidity, uint256 positionId
    );
    event EthZapped(
        uint8 indexed version, address indexed token, address indexed recipient,
        uint256 ethIn, uint256 tokenIn, uint256 positionId
    );
    event FeeBpsUpdated(uint256 oldBps, uint256 newBps);
    event PlatformTokenUpdated(address indexed oldToken, address indexed newToken);
    event BuybackPoolUpdated(address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks);
    event BuybackProtectionUpdated(uint256 minOutPerEth);
    event BuybackPoolCleared();
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPoolManager();
    error FeeOutOfBounds();
    error NothingToSend();
    error InsufficientOutput();
    error InvalidBuybackPool();
    error InvalidPoolKey();
    error InvalidLiquidity();
    error ZapNotImplemented();
    error BuybackFailed();
    error EthRecoveryFailed();
    error InvalidUnlockData();
    error InvalidGovernance();

    struct ZapParams {
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
        uint256 swapEth;
        uint256 minTokenOut;
        address recipient;
    }

    constructor(
        address platformToken_,
        uint256 requiredHoldAmount_,
        address weth_,
        address v3PositionManager_,
        address v4PoolManager_,
        address v4PositionManager_,
        address permit2_,
        address approvedHooks_
    ) {
        if (weth_ == address(0) || v3PositionManager_ == address(0) ||
            v4PoolManager_ == address(0) || v4PositionManager_ == address(0) || permit2_ == address(0)) {
            revert InvalidGovernance();
        }
        platformToken = platformToken_;
        platformTokenSet = platformToken_ != address(0);
        requiredHoldAmount = requiredHoldAmount_;
        weth = weth_;
        v3PositionManager = v3PositionManager_;
        v4PoolManager = v4PoolManager_;
        v4PositionManager = v4PositionManager_;
        permit2 = permit2_;
        approvedHooks = approvedHooks_;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /* -------------------------------------------------------- admin ------ */

    /// @notice Configure or replace the platform token before buyback routing is enabled.
    /// The buyback pool must be configured again after changing the token.
    function setPlatformToken(address newToken) external onlyOwner {
        if (newToken == address(0) || (platformTokenSet && newToken == platformToken) || buybackPoolSet) revert InvalidGovernance();
        address oldToken = platformToken;
        platformToken = newToken;
        platformTokenSet = true;
        emit PlatformTokenUpdated(oldToken, newToken);
    }

    function setFeeBps(uint256 newBps) external onlyOwner {
        if (newBps < 70 || newBps > 120) revert FeeOutOfBounds();
        emit FeeBpsUpdated(feeBps, newBps);
        feeBps = newBps;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidGovernance();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert InvalidGovernance();
        address oldOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, owner);
    }

    /// Points the buyback swap at the launchpad's native-ETH/platform-token
    /// V4 pool. Native ETH (address(0)) must be currency0 — matches every
    /// pool key ponspool builds elsewhere (see src/lib/v4pool.ts on the UI side).
    function setBuybackPool(PoolKey calldata key, uint256 minOutPerEth) external onlyOwner {
        if (!platformTokenSet || key.currency0 != address(0) || key.currency1 != platformToken || key.hooks != approvedHooks || minOutPerEth == 0) revert InvalidBuybackPool();
        buybackPoolKey = key;
        buybackPoolSet = true;
        buybackMinOutPerEth = minOutPerEth;
        emit BuybackPoolUpdated(key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks);
        emit BuybackProtectionUpdated(minOutPerEth);
    }

    /// @notice Disable the current buyback route before changing platformToken.
    function clearBuybackPool() external onlyOwner {
        buybackPoolSet = false;
        buybackMinOutPerEth = 0;
        delete buybackPoolKey;
        emit BuybackPoolCleared();
    }

    /* -------------------------------------------------------- views ------ */

    /// Strict on-chain gate: holders of the threshold are 100% exempt.
    function isHolder(address who) public view returns (bool) {
        if (!platformTokenSet) return false;
        return IERC20(platformToken).balanceOf(who) >= requiredHoldAmount;
    }

    /* ------------------------------------------------- core mechanics ---- */

    /// Holder check + cut handling. Holders: (0, totalEth). Non-holders:
    /// the cut is swapped into platform token and burned to DEAD, atomically,
    /// via a direct PoolManager unlock — no V2 pair, no treasury hop.
    function _handleFeeAndBurn(uint256 totalEth) internal returns (uint256 fee, uint256 net) {
        if (isHolder(msg.sender)) return (0, totalEth);
        // Nothing configured to burn into yet — charge nothing rather than
        // strand ETH the router has no route to swap.
        if (!buybackPoolSet) return (0, totalEth);
        fee = (totalEth * feeBps) / 10_000;
        if (fee == 0) return (0, totalEth);
        net = totalEth - fee;

        bytes memory result = IPoolManagerV4(v4PoolManager).unlock(abi.encode(uint8(1), fee));
        uint256 burned = abi.decode(result, (uint256));
        emit PlatformCut(msg.sender, fee, burned);
    }

    /// PoolManager calls back into here mid-`unlock`. Swaps the fee's worth
    /// of native ETH for platform token and takes the output straight to
    /// DEAD — the take() *is* the burn, there's no intermediate custody.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != v4PoolManager) revert NotPoolManager();
        uint8 action = abi.decode(data, (uint8));
        if (action == 2) {
            (, PoolKey memory key, uint256 ethIn) = abi.decode(data, (uint8, PoolKey, uint256));
            if (ethIn == 0 || key.currency0 != address(0) || key.currency1 == address(0) || key.hooks != approvedHooks) revert BuybackFailed();
            IPoolManagerV4.SwapParams memory zapParams = IPoolManagerV4.SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(ethIn),
                sqrtPriceLimitX96: MIN_SQRT_PRICE_LIMIT
            });
            int256 zapDelta = IPoolManagerV4(v4PoolManager).swap(key, zapParams, "");
            int128 zapAmount1 = int128(zapDelta);
            if (zapAmount1 >= 0) revert BuybackFailed();
            uint256 zapOut = uint256(uint128(-zapAmount1));
            IPoolManagerV4(v4PoolManager).settle{value: ethIn}();
            IPoolManagerV4(v4PoolManager).take(key.currency1, address(this), zapOut);
            return abi.encode(zapOut);
        }
        if (action != 1) revert BuybackFailed();
        (, uint256 buybackEthIn) = abi.decode(data, (uint8, uint256));
        if (!buybackPoolSet || buybackEthIn == 0) revert BuybackFailed();

        IPoolManagerV4.SwapParams memory params = IPoolManagerV4.SwapParams({
            zeroForOne: true, // selling currency0 (native ETH) for currency1 (platform token)
            amountSpecified: -int256(buybackEthIn), // negative = exact input
            sqrtPriceLimitX96: MIN_SQRT_PRICE_LIMIT
        });

        int256 delta = IPoolManagerV4(v4PoolManager).swap(buybackPoolKey, params, "");
        // amount1 (platform token owed to us) sits in the low 128 bits.
        int128 amount1 = int128(delta);
        if (amount1 >= 0) revert BuybackFailed();
        uint256 amountOut = uint256(uint128(-amount1));
        if (amountOut < (buybackEthIn * buybackMinOutPerEth) / 1e18) revert InsufficientOutput();

        IPoolManagerV4(v4PoolManager).settle{value: buybackEthIn}();
        IPoolManagerV4(v4PoolManager).take(platformToken, DEAD, amountOut);

        return abi.encode(amountOut);
    }

    /* ----------------------------------------------------- V4 routes ----- */

    function _mintV3(
        address token, uint24 fee, int24 tickLower, int24 tickUpper,
        uint256 net, uint256 received, uint256 tokenAmountMin, uint256 ethAmountMin,
        address recipient
    ) private returns (uint256 tokenId, uint128 liquidity) {
        IWETH(weth).deposit{value: net}();
        IERC20(weth).approve(v3PositionManager, 0);
        IERC20(weth).approve(v3PositionManager, net);
        IERC20(token).approve(v3PositionManager, 0);
        IERC20(token).approve(v3PositionManager, received);
        if (weth < token) {
            (tokenId, liquidity,,) = IPositionManagerV3(v3PositionManager).mint(
                IPositionManagerV3.MintParams({
                    token0: weth, token1: token, fee: fee, tickLower: tickLower, tickUpper: tickUpper,
                    amount0Desired: net, amount1Desired: received, amount0Min: ethAmountMin,
                    amount1Min: tokenAmountMin, recipient: recipient, deadline: block.timestamp + 30 minutes
                })
            );
        } else {
            (tokenId, liquidity,,) = IPositionManagerV3(v3PositionManager).mint(
                IPositionManagerV3.MintParams({
                    token0: token, token1: weth, fee: fee, tickLower: tickLower, tickUpper: tickUpper,
                    amount0Desired: received, amount1Desired: net, amount0Min: tokenAmountMin,
                    amount1Min: ethAmountMin, recipient: recipient, deadline: block.timestamp + 30 minutes
                })
            );
        }
    }

    function _injectV3(
        address token, uint24 fee, int24 tickLower, int24 tickUpper,
        uint256 tokenAmount, uint256 tokenAmountMin, uint256 ethAmountMin,
        address recipient
    ) internal returns (uint256 tokenId, uint128 liquidity) {
        if (msg.value == 0 || token == address(0) || recipient == address(0) || tokenAmount == 0) revert InvalidLiquidity();
        (, uint256 net) = _handleFeeAndBurn(msg.value);
        uint256 tokenBefore = IERC20(token).balanceOf(address(this));
        if (!IERC20(token).transferFrom(msg.sender, address(this), tokenAmount)) revert InvalidLiquidity();
        uint256 received = IERC20(token).balanceOf(address(this)) - tokenBefore;
        if (received == 0) revert InvalidLiquidity();
        (tokenId, liquidity) = _mintV3(token, fee, tickLower, tickUpper, net, received, tokenAmountMin, ethAmountMin, recipient);
        uint256 tokenAfter = IERC20(token).balanceOf(address(this));
        if (tokenAfter > tokenBefore && !IERC20(token).transfer(msg.sender, tokenAfter - tokenBefore)) revert InvalidLiquidity();
        uint256 wethAfter = IERC20(weth).balanceOf(address(this));
        if (wethAfter > 0) {
            if (!IERC20(weth).transfer(msg.sender, wethAfter)) revert InvalidLiquidity();
        }
        emit DualInjected(3, token, recipient, net, received, liquidity, tokenId);
    }

    function injectV3(
        address token, uint24 fee, int24 tickLower, int24 tickUpper,
        uint256 tokenAmount, uint256 tokenAmountMin, uint256 ethAmountMin,
        address recipient
    ) external payable returns (uint256 tokenId, uint128 liquidity) {
        return _injectV3(token, fee, tickLower, tickUpper, tokenAmount, tokenAmountMin, ethAmountMin, recipient);
    }

    /// Dual-asset liquidity on the v4 singleton via the PositionManager unlock pattern.
    function injectV4(PoolKey calldata key, IPositionManagerV4.ModifyLiquidityParams calldata params, bytes calldata hookData, uint256 tokenAmountMax)
        external payable returns (bytes32 deltaId)
    {
        if (msg.value == 0) revert NothingToSend();
        if (key.currency0 != address(0) || key.currency1 == address(0) || key.hooks != approvedHooks) revert InvalidPoolKey();
        if (params.liquidityDelta <= 0 || tokenAmountMax == 0) revert InvalidLiquidity();
        if (hookData.length == 0) revert InvalidUnlockData();
        (, uint256 net) = _handleFeeAndBurn(msg.value);
        address token = key.currency1;
        uint256 tokenBefore = _pullToken(token, tokenAmountMax);
        uint256 ethBefore = address(this).balance - net;

        // hookData carries the canonical PositionManager unlockData produced
        // by the frontend. Empty or ad-hoc payloads are rejected above.
        bytes memory unlockData = hookData;
        IPositionManagerV4(v4PositionManager).modifyLiquidities{value: net}(unlockData, block.timestamp + 30 minutes);
        uint256 tokenAfter = IERC20(token).balanceOf(address(this));
        if (tokenAfter > tokenBefore && !IERC20(token).transfer(msg.sender, tokenAfter - tokenBefore)) revert InvalidLiquidity();
        uint256 ethAfter = address(this).balance;
        if (ethAfter > ethBefore) {
            (bool refunded,) = payable(msg.sender).call{value: ethAfter - ethBefore}("");
            if (!refunded) revert EthRecoveryFailed();
        }
        deltaId = keccak256(abi.encode(msg.sender, key, params.salt));
        emit DualInjected(4, token, msg.sender, net, tokenAmountMax, 0, uint256(deltaId));
    }

    function initializeV4(PoolKey calldata key, uint160 sqrtPriceX96) external onlyOwner returns (int24 tick) {
        if (key.currency0 != address(0) || key.currency1 == address(0) || key.hooks != approvedHooks || sqrtPriceX96 == 0) revert InvalidPoolKey();
        tick = IPoolManagerV4(v4PoolManager).initialize(key, sqrtPriceX96);
    }

    function _mintV4FromZap(
        PoolKey calldata key, int24 tickLower, int24 tickUpper, int256 liquidityDelta,
        uint256 ethAmount, uint256 tokenAmount, address recipient, bytes calldata hookData
    ) private {
        bytes memory actions = hex"020d";
        bytes memory mintParams = abi.encode(
            key, tickLower, tickUpper, uint256(liquidityDelta),
            uint128(ethAmount), uint128(tokenAmount), recipient, hookData
        );
        bytes[] memory params = new bytes[](2);
        params[0] = mintParams;
        params[1] = abi.encode(key.currency0, key.currency1);
        IPositionManagerV4(v4PositionManager).modifyLiquidities{value: ethAmount}(
            abi.encode(actions, params), block.timestamp + 30 minutes
        );
    }

    /// @notice Swap part of the caller's ETH into the paired token, then mint
    /// a concentrated-liquidity position with the remaining ETH and swap output.
    function zapEthV4(PoolKey calldata key, ZapParams calldata params, bytes calldata hookData)
        external payable returns (bytes32 deltaId)
    {
        if (msg.value == 0 || params.swapEth == 0 || params.swapEth >= msg.value || params.recipient == address(0)) revert InvalidLiquidity();
        if (key.currency0 != address(0) || key.currency1 == address(0) || key.hooks != approvedHooks) revert InvalidPoolKey();
        if (params.liquidityDelta <= 0 || hookData.length == 0) revert InvalidUnlockData();
        (, uint256 net) = _handleFeeAndBurn(msg.value);
        if (params.swapEth >= net) revert InvalidLiquidity();

        bytes memory result = IPoolManagerV4(v4PoolManager).unlock(abi.encode(uint8(2), key, params.swapEth));
        uint256 tokenOut = abi.decode(result, (uint256));
        if (tokenOut < params.minTokenOut) revert InsufficientOutput();
        uint256 tokenBefore = IERC20(key.currency1).balanceOf(address(this));
        if (tokenOut > type(uint160).max) revert InvalidLiquidity();
        IERC20(key.currency1).approve(v4PositionManager, 0);
        IPermit2(permit2).approve(key.currency1, v4PositionManager, uint160(tokenOut), type(uint48).max);

        _mintV4FromZap(key, params.tickLower, params.tickUpper, params.liquidityDelta, net - params.swapEth, tokenOut, params.recipient, hookData);

        uint256 tokenAfter = IERC20(key.currency1).balanceOf(address(this));
        if (tokenAfter > tokenBefore && !IERC20(key.currency1).transfer(msg.sender, tokenAfter - tokenBefore)) revert InvalidLiquidity();
        uint256 ethAfter = address(this).balance;
        if (ethAfter > 0) {
            (bool refunded,) = payable(msg.sender).call{value: ethAfter}("");
            if (!refunded) revert EthRecoveryFailed();
        }
        deltaId = keccak256(abi.encode(msg.sender, key, params.tickLower, params.tickUpper, params.liquidityDelta));
        emit EthZapped(4, key.currency1, params.recipient, net, tokenOut, uint256(deltaId));
    }

    function recoverEth(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0) || amount > address(this).balance) revert EthRecoveryFailed();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthRecoveryFailed();
    }

    function _pullToken(address token, uint256 amount) private returns (uint256 beforeBalance) {
        beforeBalance = IERC20(token).balanceOf(address(this));
        if (!IERC20(token).transferFrom(msg.sender, address(this), amount)) revert InvalidLiquidity();
        uint256 received = IERC20(token).balanceOf(address(this)) - beforeBalance;
        if (received == 0 || received > type(uint160).max) revert InvalidLiquidity();
        IERC20(token).approve(v4PositionManager, 0);
        IPermit2(permit2).approve(token, v4PositionManager, uint160(received), type(uint48).max);
    }

    receive() external payable {}
}
