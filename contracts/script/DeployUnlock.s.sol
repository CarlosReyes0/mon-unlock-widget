// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {ArticleUnlock} from "../src/ArticleUnlock.sol";
import {ArticleUnlockUsdc} from "../src/ArticleUnlockUsdc.sol";
import {UnlockDeployBase} from "./UnlockDeployBase.sol";

/// @notice Deploy ArticleUnlock and ArticleUnlockUsdc with a cold owner and a relayer.
///
/// Env (addresses only — never a key for the owner):
///   OWNER_ADDRESS     cold wallet that will own both contracts
///   RELAYER_ADDRESS   hot wallet that may call registerArticleFor
///   USDC_TOKEN        optional; defaults to Circle USDC on Monad mainnet
///
/// Signer: DEPLOYER_PRIVATE_KEY, or PRIVATE_KEY, or an interactive forge signer.
/// Do not commit the key. Do not pass it as a logged argument.
///
/// The constructor sets owner and relayer. The owner calls setRelayer later
/// only when rotating that hot wallet (script/SetRelayer.s.sol).
contract DeployUnlockContracts is UnlockDeployBase {
    /// Circle USDC on Monad mainnet. Public token address, not a secret.
    address constant MONAD_USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    function run() external {
        address owner_ = requireAddress("OWNER_ADDRESS");
        address relayer_ = requireAddress("RELAYER_ADDRESS");
        address usdcToken = vm.envOr("USDC_TOKEN", MONAD_USDC);
        require(usdcToken != address(0), "USDC_TOKEN is required");

        startDeployerBroadcast();
        ArticleUnlock mon = new ArticleUnlock(owner_, relayer_);
        ArticleUnlockUsdc usdc = new ArticleUnlockUsdc(usdcToken, owner_, relayer_);
        vm.stopBroadcast();

        console2.log("ArticleUnlock:", address(mon));
        console2.log("ArticleUnlockUsdc:", address(usdc));
        console2.log("owner:", owner_);
        console2.log("relayer:", relayer_);
        console2.log("usdc token:", usdcToken);
        console2.log("setRelayer: not required at deploy; owner uses script/SetRelayer.s.sol to rotate");
    }
}
