// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {ArticleUnlock} from "../src/ArticleUnlock.sol";
import {ArticleUnlockUsdc} from "../src/ArticleUnlockUsdc.sol";
import {UnlockDeployBase} from "./UnlockDeployBase.sol";

/// @notice Owner-only relayer rotation. Broadcast as the current owner.
///
/// Env:
///   RELAYER_ADDRESS  new hot wallet for registerArticleFor
///   UNLOCK_MON       ArticleUnlock address (optional if USDC is set)
///   UNLOCK_USDC      ArticleUnlockUsdc address (optional if MON is set)
///
/// Signer: the owner. DEPLOYER_PRIVATE_KEY / PRIVATE_KEY, or an interactive signer.
/// The relayer key is not used here and must not be committed.
contract SetUnlockRelayer is UnlockDeployBase {
    function run() external {
        address relayer_ = requireAddress("RELAYER_ADDRESS");
        address mon = optionalAddress("UNLOCK_MON");
        address usdc = optionalAddress("UNLOCK_USDC");
        require(mon != address(0) || usdc != address(0), "UNLOCK_MON or UNLOCK_USDC is required");

        startDeployerBroadcast();
        if (mon != address(0)) {
            ArticleUnlock(mon).setRelayer(relayer_);
            console2.log("ArticleUnlock relayer set:", mon);
        }
        if (usdc != address(0)) {
            ArticleUnlockUsdc(usdc).setRelayer(relayer_);
            console2.log("ArticleUnlockUsdc relayer set:", usdc);
        }
        vm.stopBroadcast();

        console2.log("relayer:", relayer_);
    }
}
