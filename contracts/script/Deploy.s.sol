// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {ArticleUnlock} from "../src/ArticleUnlock.sol";
import {UnlockDeployBase} from "./UnlockDeployBase.sol";

/// @notice Deploy ArticleUnlock only. Prefer script/DeployUnlock.s.sol to deploy both.
///
/// Env: OWNER_ADDRESS, RELAYER_ADDRESS.
/// Signer: DEPLOYER_PRIVATE_KEY, PRIVATE_KEY, or an interactive forge signer.
contract DeployArticleUnlock is UnlockDeployBase {
    function run() external {
        address owner_ = requireAddress("OWNER_ADDRESS");
        address relayer_ = requireAddress("RELAYER_ADDRESS");

        startDeployerBroadcast();
        ArticleUnlock unlock = new ArticleUnlock(owner_, relayer_);
        vm.stopBroadcast();

        console2.log("ArticleUnlock:", address(unlock));
        console2.log("owner:", owner_);
        console2.log("relayer:", relayer_);
    }
}
