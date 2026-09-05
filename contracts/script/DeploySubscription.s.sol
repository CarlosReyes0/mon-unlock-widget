// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {WriterSubscription} from "../src/WriterSubscription.sol";

/// @notice Deploy Monad USDC writer subscriptions.
///         USDC_TOKEN default: Circle USDC on Monad 0x754704Bc059F8C67012fEd69BC8A327a5aafb603
contract DeployWriterSubscription is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address usdcToken = vm.envAddress("USDC_TOKEN");

        vm.startBroadcast(deployerKey);
        WriterSubscription sub = new WriterSubscription(usdcToken);
        vm.stopBroadcast();

        console2.log("WriterSubscription deployed:", address(sub));
        console2.log("USDC token:", usdcToken);
    }
}
