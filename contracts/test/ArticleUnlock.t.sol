// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArticleUnlock} from "../src/ArticleUnlock.sol";

contract ArticleUnlockTest is Test {
    ArticleUnlock unlock;
    address publisher = makeAddr("publisher");
    address reader = makeAddr("reader");
    bytes32 articleId = keccak256("founder-manifesto");

    function setUp() public {
        unlock = new ArticleUnlock();
        vm.prank(publisher);
        unlock.registerArticle(articleId, 5 ether);
    }

    function test_unlock_pays_publisher() public {
        vm.deal(reader, 10 ether);
        vm.prank(reader);
        unlock.unlock{value: 5 ether}(articleId);

        assertTrue(unlock.hasUnlocked(reader, articleId));
        assertEq(publisher.balance, 5 ether);
    }

    function test_revert_insufficient_payment() public {
        vm.deal(reader, 1 ether);
        vm.prank(reader);
        vm.expectRevert(ArticleUnlock.InsufficientPayment.selector);
        unlock.unlock{value: 1 ether}(articleId);
    }

    function test_revert_double_unlock() public {
        vm.deal(reader, 10 ether);
        vm.prank(reader);
        unlock.unlock{value: 5 ether}(articleId);

        vm.prank(reader);
        vm.expectRevert(ArticleUnlock.AlreadyUnlocked.selector);
        unlock.unlock{value: 5 ether}(articleId);
    }

    function test_articleIdFromString() public view {
        assertEq(
            unlock.articleIdFromString("founder-manifesto"),
            keccak256("founder-manifesto")
        );
    }
}
