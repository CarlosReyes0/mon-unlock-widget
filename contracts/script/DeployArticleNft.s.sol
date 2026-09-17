// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ArticleNFT} from "../src/ArticleNFT.sol";

/// @notice Deploy ArticleNFT on Monad. Writers and readers mint from their own wallets (they pay gas).
///
/// Env:
///   PRIVATE_KEY          deployer (becomes owner; can setBaseURI / unlock contracts)
///   UNLOCK_MON           ArticleUnlock (native MON). Default: mainnet 0x27cA0c23835328e2Ab1424b66330be86fe177FA6
///   UNLOCK_USDC          ArticleUnlockUsdc. Default: mainnet 0xd66Df017335ae80BcE5d4Ec728421f3a3DAf6f9f
///   NFT_BASE_URI         metadata prefix, must end with /  e.g.
///                        https://mon-unlock-widget-production.up.railway.app/api/article-nfts/metadata/
contract DeployArticleNft is Script {
    address constant MAINNET_UNLOCK_MON = 0x27cA0c23835328e2Ab1424b66330be86fe177FA6;
    address constant MAINNET_UNLOCK_USDC = 0xd66Df017335ae80BcE5d4Ec728421f3a3DAf6f9f;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address unlockMon = vm.envOr("UNLOCK_MON", MAINNET_UNLOCK_MON);
        address unlockUsdc = vm.envOr("UNLOCK_USDC", MAINNET_UNLOCK_USDC);
        string memory baseURI = vm.envOr(
            "NFT_BASE_URI",
            string("https://mon-unlock-widget-production.up.railway.app/api/article-nfts/metadata/")
        );

        vm.startBroadcast(deployerKey);
        ArticleNFT nft = new ArticleNFT(unlockMon, unlockUsdc, baseURI);
        vm.stopBroadcast();

        console2.log("ArticleNFT deployed:", address(nft));
        console2.log("unlockMon:", unlockMon);
        console2.log("unlockUsdc:", unlockUsdc);
        console2.log("baseURI:", baseURI);
        console2.log("Set ARTICLE_NFT_CONTRACT and VITE_ARTICLE_NFT_CONTRACT to the address above.");
    }
}
