// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

/// @notice Shared broadcast helper. The deployer key stays in the environment
///         or in an interactive signer. It is never logged or committed.
abstract contract UnlockDeployBase is Script {
    /// @dev DEPLOYER_PRIVATE_KEY, else PRIVATE_KEY, else the forge signer
    ///      (`--account`, `--interactives`, or an unlocked `--sender`).
    function startDeployerBroadcast() internal {
        if (vm.envExists("DEPLOYER_PRIVATE_KEY")) {
            vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
            return;
        }
        if (vm.envExists("PRIVATE_KEY")) {
            vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
            return;
        }
        vm.startBroadcast();
    }

    function requireAddress(string memory key) internal view returns (address) {
        address a = vm.envAddress(key);
        require(a != address(0), string.concat(key, " is required"));
        return a;
    }

    /// @dev Missing env var yields address(0). A present zero address also yields address(0).
    function optionalAddress(string memory key) internal view returns (address) {
        if (!vm.envExists(key)) return address(0);
        return vm.envAddress(key);
    }
}
