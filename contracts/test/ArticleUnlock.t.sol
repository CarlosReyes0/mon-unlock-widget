// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArticleUnlock} from "../src/ArticleUnlock.sol";

contract ArticleUnlockTest is Test {
    ArticleUnlock unlock;
    address publisher = makeAddr("publisher");
    address otherPublisher = makeAddr("otherPublisher");
    address reader = makeAddr("reader");
    bytes32 articleId = keccak256("founder-manifesto");

    function setUp() public {
        // This test contract is both owner and relayer, matching the previous
        // single-key setup so existing registerArticleFor calls still succeed.
        unlock = new ArticleUnlock(address(this), address(this));
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

    function test_same_publisher_can_reregister() public {
        vm.prank(publisher);
        unlock.registerArticle(articleId, 3 ether);
        (uint256 priceWei, address owner, bool active) = unlock.getArticle(articleId);
        assertEq(priceWei, 3 ether);
        assertEq(owner, publisher);
        assertTrue(active);
    }

    function test_revert_article_taken_by_other_publisher() public {
        vm.prank(otherPublisher);
        vm.expectRevert(
            abi.encodeWithSelector(ArticleUnlock.ArticleTaken.selector, publisher)
        );
        unlock.registerArticle(articleId, 1 ether);
    }

    function test_registerArticleFor_reverts_when_taken() public {
        vm.expectRevert(
            abi.encodeWithSelector(ArticleUnlock.ArticleTaken.selector, publisher)
        );
        unlock.registerArticleFor(articleId, 1 ether, otherPublisher);
    }

    function test_registerArticleFor_allows_same_publisher() public {
        unlock.registerArticleFor(articleId, 2 ether, publisher);
        (uint256 priceWei, address owner, ) = unlock.getArticle(articleId);
        assertEq(priceWei, 2 ether);
        assertEq(owner, publisher);
    }

    function test_reader_selectors_unchanged() public pure {
        assertEq(ArticleUnlock.unlock.selector, bytes4(keccak256("unlock(bytes32)")));
        assertEq(
            ArticleUnlock.hasUnlocked.selector,
            bytes4(keccak256("hasUnlocked(address,bytes32)"))
        );
        assertEq(ArticleUnlock.getArticle.selector, bytes4(keccak256("getArticle(bytes32)")));
        assertEq(
            ArticleUnlock.registerArticle.selector,
            bytes4(keccak256("registerArticle(bytes32,uint256)"))
        );
        assertEq(
            ArticleUnlock.registerArticleFor.selector,
            bytes4(keccak256("registerArticleFor(bytes32,uint256,address)"))
        );
        assertEq(
            ArticleUnlock.updatePrice.selector,
            bytes4(keccak256("updatePrice(bytes32,uint256)"))
        );
        assertEq(ArticleUnlock.setActive.selector, bytes4(keccak256("setActive(bytes32,bool)")));
        assertEq(
            ArticleUnlock.ArticleUnlocked.selector,
            keccak256("ArticleUnlocked(address,bytes32,uint256,address)")
        );
        assertEq(
            ArticleUnlock.ArticleRegistered.selector,
            keccak256("ArticleRegistered(bytes32,uint256,address)")
        );
    }

    function test_relayer_registers_owner_does_not() public {
        address cold = makeAddr("cold");
        address relay = makeAddr("relay");
        ArticleUnlock split = new ArticleUnlock(cold, relay);
        bytes32 id = keccak256("role-split");

        vm.prank(cold);
        vm.expectRevert(ArticleUnlock.NotRelayer.selector);
        split.registerArticleFor(id, 1 ether, publisher);

        vm.prank(relay);
        split.registerArticleFor(id, 1 ether, publisher);
        (uint256 priceWei, address who, bool active) = split.getArticle(id);
        assertEq(priceWei, 1 ether);
        assertEq(who, publisher);
        assertTrue(active);
    }

    function test_updatePrice_publisher_or_owner_not_relayer() public {
        address cold = makeAddr("cold");
        address relay = makeAddr("relay");
        ArticleUnlock split = new ArticleUnlock(cold, relay);
        bytes32 id = keccak256("price-roles");
        vm.prank(relay);
        split.registerArticleFor(id, 1 ether, publisher);

        vm.prank(relay);
        vm.expectRevert(ArticleUnlock.NotOwner.selector);
        split.updatePrice(id, 2 ether);

        vm.prank(publisher);
        split.updatePrice(id, 2 ether);
        (uint256 priceWei, , ) = split.getArticle(id);
        assertEq(priceWei, 2 ether);

        vm.prank(cold);
        split.updatePrice(id, 3 ether);
        (priceWei, , ) = split.getArticle(id);
        assertEq(priceWei, 3 ether);
    }

    function test_setActive_publisher_or_owner_not_relayer() public {
        address cold = makeAddr("cold");
        address relay = makeAddr("relay");
        ArticleUnlock split = new ArticleUnlock(cold, relay);
        bytes32 id = keccak256("active-roles");
        vm.prank(relay);
        split.registerArticleFor(id, 1 ether, publisher);

        vm.prank(relay);
        vm.expectRevert(ArticleUnlock.NotOwner.selector);
        split.setActive(id, false);

        vm.prank(publisher);
        split.setActive(id, false);
        (, , bool active) = split.getArticle(id);
        assertFalse(active);

        vm.prank(cold);
        split.setActive(id, true);
        (, , active) = split.getArticle(id);
        assertTrue(active);

        vm.prank(cold);
        split.setActive(id, false);
        (, , active) = split.getArticle(id);
        assertFalse(active);
    }

    function test_setRelayer_rotates_and_is_owner_only() public {
        address cold = makeAddr("cold");
        address relay = makeAddr("relay");
        address next = makeAddr("nextRelay");
        ArticleUnlock split = new ArticleUnlock(cold, relay);
        bytes32 id = keccak256("rotate-relayer");

        vm.prank(relay);
        vm.expectRevert(ArticleUnlock.NotOwner.selector);
        split.setRelayer(next);

        vm.prank(cold);
        vm.expectRevert(ArticleUnlock.InvalidAddress.selector);
        split.setRelayer(address(0));

        vm.expectEmit(true, true, false, true, address(split));
        emit ArticleUnlock.RelayerUpdated(relay, next);
        vm.prank(cold);
        split.setRelayer(next);
        assertEq(split.relayer(), next);

        vm.prank(relay);
        vm.expectRevert(ArticleUnlock.NotRelayer.selector);
        split.registerArticleFor(id, 1 ether, publisher);

        vm.prank(next);
        split.registerArticleFor(id, 1 ether, publisher);
        (, address who, ) = split.getArticle(id);
        assertEq(who, publisher);
    }

    function test_two_step_ownership() public {
        address cold = makeAddr("cold");
        address relay = makeAddr("relay");
        address next = makeAddr("nextOwner");
        ArticleUnlock split = new ArticleUnlock(cold, relay);

        vm.prank(relay);
        vm.expectRevert(ArticleUnlock.NotOwner.selector);
        split.transferOwnership(next);

        vm.prank(cold);
        vm.expectRevert(ArticleUnlock.InvalidAddress.selector);
        split.transferOwnership(address(0));

        vm.expectEmit(true, true, false, true, address(split));
        emit ArticleUnlock.OwnershipTransferStarted(cold, next);
        vm.prank(cold);
        split.transferOwnership(next);
        assertEq(split.owner(), cold);
        assertEq(split.pendingOwner(), next);

        vm.prank(cold);
        vm.expectRevert(ArticleUnlock.NotOwner.selector);
        split.acceptOwnership();

        vm.expectEmit(true, true, false, true, address(split));
        emit ArticleUnlock.OwnershipTransferred(cold, next);
        vm.prank(next);
        split.acceptOwnership();
        assertEq(split.owner(), next);
        assertEq(split.pendingOwner(), address(0));

        vm.prank(cold);
        vm.expectRevert(ArticleUnlock.NotOwner.selector);
        split.setRelayer(relay);

        vm.prank(next);
        split.setRelayer(makeAddr("laterRelay"));
    }

    function test_constructor_rejects_zero_addresses() public {
        vm.expectRevert(ArticleUnlock.InvalidAddress.selector);
        new ArticleUnlock(address(0), makeAddr("relay"));
        vm.expectRevert(ArticleUnlock.InvalidAddress.selector);
        new ArticleUnlock(makeAddr("cold"), address(0));
    }

    function test_unlock_still_pays_publisher_after_role_split() public {
        address cold = makeAddr("cold");
        address relay = makeAddr("relay");
        ArticleUnlock split = new ArticleUnlock(cold, relay);
        bytes32 id = keccak256("still-unlocks");
        vm.prank(relay);
        split.registerArticleFor(id, 1 ether, publisher);

        vm.deal(reader, 1 ether);
        vm.prank(reader);
        split.unlock{value: 1 ether}(id);
        assertTrue(split.hasUnlocked(reader, id));
        assertEq(publisher.balance, 1 ether);
    }
}
