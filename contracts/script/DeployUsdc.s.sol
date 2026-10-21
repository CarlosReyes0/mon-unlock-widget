// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {ArticleUnlockUsdc} from "../src/ArticleUnlockUsdc.sol";
import {UnlockDeployBase} from "./UnlockDeployBase.sol";

/// @notice Deploy ArticleUnlockUsdc only. Prefer script/DeployUnlock.s.sol to deploy both.
///
/// Env: OWNER_ADDRESS, RELAYER_ADDRESS.
///       USDC_TOKEN optional; defaults to Circle USDC on Monad mainnet.
/// Signer: DEPLOYER_PRIVATE_KEY, PRIVATE_KEY, or an interactive forge signer.
contract DeployArticleUnlockUsdc is UnlockDeployBase {
    address constant MONAD_USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    function run() external {
        address owner_ = requireAddress("OWNER_ADDRESS");
        address relayer_ = requireAddress("RELAYER_ADDRESS");
        address usdcToken = vm.envOr("USDC_TOKEN", MONAD_USDC);
        require(usdcToken != address(0), "USDC_TOKEN is required");

        startDeployerBroadcast();
        ArticleUnlockUsdc unlock = new ArticleUnlockUsdc(usdcToken, owner_, relayer_);
        vm.stopBroadcast();

        console2.log("ArticleUnlockUsdc:", address(unlock));
        console2.log("owner:", owner_);
        console2.log("relayer:", relayer_);
        console2.log("usdc token:", usdcToken);
    }
}
