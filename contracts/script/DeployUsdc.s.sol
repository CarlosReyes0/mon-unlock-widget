// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ArticleUnlockUsdc} from "../src/ArticleUnlockUsdc.sol";

/// @notice Deploy USDC paywall. Set USDC_TOKEN (Circle USDC on Monad mainnet:
///         0x754704Bc059F8C67012fEd69BC8A327a5aafb603).
contract DeployArticleUnlockUsdc is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address usdcToken = vm.envAddress("USDC_TOKEN");
        address publisher = vm.envOr("PUBLISHER_ADDRESS", address(0));

        vm.startBroadcast(deployerKey);

        ArticleUnlockUsdc unlock = new ArticleUnlockUsdc(usdcToken);

        if (publisher != address(0)) {
            // Demo article: $0.50 USDC — slug must match widget article-id
            bytes32 demoId = keccak256("founder-manifesto");
            unlock.registerArticleFor(demoId, 500_000, publisher);
            console2.log("Demo article registered at $0.50 USDC for", publisher);
        }

        vm.stopBroadcast();

        console2.log("ArticleUnlockUsdc deployed:", address(unlock));
        console2.log("USDC token:", usdcToken);
    }
}
