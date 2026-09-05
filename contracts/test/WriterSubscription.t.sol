// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WriterSubscription} from "../src/WriterSubscription.sol";

contract MockUsdc {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount || balanceOf[from] < amount) return false;
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract WriterSubscriptionTest is Test {
    WriterSubscription sub;
    MockUsdc usdc;
    address writer = makeAddr("writer");
    address reader = makeAddr("reader");
    uint256 constant FIVE = 5_000_000;

    function setUp() public {
        usdc = new MockUsdc();
        sub = new WriterSubscription(address(usdc));
        vm.prank(writer);
        sub.setPlan(FIVE);
    }

    function test_subscribe_pays_writer_and_is_active() public {
        usdc.mint(reader, FIVE);
        vm.startPrank(reader);
        usdc.approve(address(sub), FIVE);
        sub.subscribe(writer);
        vm.stopPrank();

        assertTrue(sub.hasActiveSubscription(reader, writer));
        assertEq(usdc.balanceOf(writer), FIVE);
        assertEq(usdc.balanceOf(reader), 0);
    }

    function test_cancel_drops_access_immediately() public {
        usdc.mint(reader, FIVE);
        vm.startPrank(reader);
        usdc.approve(address(sub), FIVE);
        sub.subscribe(writer);
        sub.cancel(writer);
        vm.stopPrank();

        assertFalse(sub.hasActiveSubscription(reader, writer));
    }

    function test_renew_after_period() public {
        usdc.mint(reader, FIVE * 2);
        vm.startPrank(reader);
        usdc.approve(address(sub), type(uint256).max);
        sub.subscribe(writer);
        vm.stopPrank();

        vm.warp(block.timestamp + 30 days);
        sub.renew(writer, reader);

        assertTrue(sub.hasActiveSubscription(reader, writer));
        assertEq(usdc.balanceOf(writer), FIVE * 2);
    }

    function test_revert_renew_too_early() public {
        usdc.mint(reader, FIVE * 2);
        vm.startPrank(reader);
        usdc.approve(address(sub), type(uint256).max);
        sub.subscribe(writer);
        vm.stopPrank();

        vm.expectRevert(WriterSubscription.TooEarly.selector);
        sub.renew(writer, reader);
    }

    function test_revert_double_subscribe() public {
        usdc.mint(reader, FIVE * 2);
        vm.startPrank(reader);
        usdc.approve(address(sub), type(uint256).max);
        sub.subscribe(writer);
        vm.expectRevert(WriterSubscription.AlreadyActive.selector);
        sub.subscribe(writer);
        vm.stopPrank();
    }

    function test_revert_without_plan() public {
        address other = makeAddr("other");
        usdc.mint(reader, FIVE);
        vm.startPrank(reader);
        usdc.approve(address(sub), FIVE);
        vm.expectRevert(WriterSubscription.PlanNotOffered.selector);
        sub.subscribe(other);
        vm.stopPrank();
    }
}
