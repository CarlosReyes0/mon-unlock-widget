// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ArticleUnlock} from "../src/ArticleUnlock.sol";

contract DeployArticleUnlock is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address publisher = vm.envAddress("PUBLISHER_ADDRESS");

        vm.startBroadcast(deployerKey);

        ArticleUnlock unlock = new ArticleUnlock();

        // Demo article: 5 MON — slug must match widget article-id="founder-manifesto"
        bytes32 demoId = keccak256("founder-manifesto");
        unlock.registerArticleFor(demoId, 5 ether, publisher);

        vm.stopBroadcast();

        console2.log("ArticleUnlock deployed:", address(unlock));
        console2.log("Demo articleId:", vm.toString(demoId));
        console2.log("Publisher:", publisher);
    }
}
