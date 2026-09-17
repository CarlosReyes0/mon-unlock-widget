// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ArticleEditionNFT} from "../src/ArticleEditionNFT.sol";

/// @notice Deploy the optional article edition NFT (Base or Base Sepolia).
///         Set ARTICLE_NFT_BASE_URI to the public metadata prefix, e.g.
///         https://mon-unlock-widget-production.up.railway.app/api/nft/
contract DeployArticleNft is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        string memory baseURI = vm.envOr(
            "ARTICLE_NFT_BASE_URI",
            string("https://mon-unlock-widget-production.up.railway.app/api/nft/")
        );

        vm.startBroadcast(deployerKey);
        ArticleEditionNFT nft = new ArticleEditionNFT(baseURI);
        vm.stopBroadcast();

        console2.log("ArticleEditionNFT deployed:", address(nft));
        console2.log("baseURI:", nft.baseURI());
        console2.log("owner:", nft.owner());
    }
}
