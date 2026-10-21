// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArticleUnlockUsdc} from "../src/ArticleUnlockUsdc.sol";

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

contract ArticleUnlockUsdcTest is Test {
    ArticleUnlockUsdc unlock;
    MockUsdc usdc;
    address publisher = makeAddr("publisher");
    address otherPublisher = makeAddr("otherPublisher");
    address reader = makeAddr("reader");
    bytes32 articleId = keccak256("founder-manifesto");
    uint256 constant ONE_USD = 1_000_000; // $1.00 USDC

    function setUp() public {
        usdc = new MockUsdc();
        unlock = new ArticleUnlockUsdc(address(usdc), address(this), address(this));
        vm.prank(publisher);
        unlock.registerArticle(articleId, 500_000); // $0.50
    }

    function test_unlock_pays_publisher_usdc() public {
        uint256 price = 500_000;
        usdc.mint(reader, price);
        vm.startPrank(reader);
        usdc.approve(address(unlock), price);
        unlock.unlock(articleId);
        vm.stopPrank();

        assertTrue(unlock.hasUnlocked(reader, articleId));
        assertEq(usdc.balanceOf(publisher), price);
        assertEq(usdc.balanceOf(reader), 0);
    }

    function test_revert_without_approval() public {
        usdc.mint(reader, 500_000);
        vm.prank(reader);
        vm.expectRevert(ArticleUnlockUsdc.TransferFailed.selector);
        unlock.unlock(articleId);
    }

    function test_revert_double_unlock() public {
        usdc.mint(reader, 1_000_000);
        vm.startPrank(reader);
        usdc.approve(address(unlock), type(uint256).max);
        unlock.unlock(articleId);
        vm.expectRevert(ArticleUnlockUsdc.AlreadyUnlocked.selector);
        unlock.unlock(articleId);
        vm.stopPrank();
    }

    function test_same_publisher_can_reregister() public {
        vm.prank(publisher);
        unlock.registerArticle(articleId, ONE_USD);
        (uint256 priceWei, address owner, bool active) = unlock.getArticle(articleId);
        assertEq(priceWei, ONE_USD);
        assertEq(owner, publisher);
        assertTrue(active);
    }

    function test_revert_article_taken_by_other_publisher() public {
        vm.prank(otherPublisher);
        vm.expectRevert(
            abi.encodeWithSelector(ArticleUnlockUsdc.ArticleTaken.selector, publisher)
        );
        unlock.registerArticle(articleId, ONE_USD);
    }

    function test_registerArticleFor_allows_same_publisher() public {
        unlock.registerArticleFor(articleId, 2 * ONE_USD, publisher);
        (uint256 priceWei, address owner, ) = unlock.getArticle(articleId);
        assertEq(priceWei, 2 * ONE_USD);
        assertEq(owner, publisher);
    }

    function test_usdc_token_immutable() public view {
        assertEq(address(unlock.usdc()), address(usdc));
    }

    function test_articleIdFromString() public view {
        assertEq(
            unlock.articleIdFromString("founder-manifesto"),
            keccak256("founder-manifesto")
        );
    }

    function test_reader_selectors_unchanged() public pure {
        assertEq(ArticleUnlockUsdc.unlock.selector, bytes4(keccak256("unlock(bytes32)")));
        assertEq(
            ArticleUnlockUsdc.hasUnlocked.selector,
            bytes4(keccak256("hasUnlocked(address,bytes32)"))
        );
        assertEq(
            ArticleUnlockUsdc.getArticle.selector,
            bytes4(keccak256("getArticle(bytes32)"))
        );
        assertEq(
            ArticleUnlockUsdc.registerArticleFor.selector,
            bytes4(keccak256("registerArticleFor(bytes32,uint256,address)"))
        );
    }

    function test_relayer_registers_owner_does_not() public {
        address cold = makeAddr("cold");
        address relay = makeAddr("relay");
        ArticleUnlockUsdc split = new ArticleUnlockUsdc(address(usdc), cold, relay);

        vm.prank(cold);
        vm.expectRevert(ArticleUnlockUsdc.NotRelayer.selector);
        split.registerArticleFor(keccak256("usdc-roles"), ONE_USD, publisher);

        vm.prank(relay);
        split.registerArticleFor(keccak256("usdc-roles"), ONE_USD, publisher);
        (, address who, ) = split.getArticle(keccak256("usdc-roles"));
        assertEq(who, publisher);
    }

    function test_updatePrice_and_setActive_skip_relayer() public {
        address cold = makeAddr("cold");
        address relay = makeAddr("relay");
        ArticleUnlockUsdc split = new ArticleUnlockUsdc(address(usdc), cold, relay);
        bytes32 id = keccak256("usdc-admin");
        vm.prank(relay);
        split.registerArticleFor(id, ONE_USD, publisher);

        vm.prank(relay);
        vm.expectRevert(ArticleUnlockUsdc.NotOwner.selector);
        split.updatePrice(id, 2 * ONE_USD);

        vm.prank(publisher);
        split.updatePrice(id, 2 * ONE_USD);

        vm.prank(relay);
        vm.expectRevert(ArticleUnlockUsdc.NotOwner.selector);
        split.setActive(id, false);

        vm.prank(cold);
        split.setActive(id, false);
        (uint256 priceWei, , bool active) = split.getArticle(id);
        assertEq(priceWei, 2 * ONE_USD);
        assertFalse(active);
    }

    function test_setRelayer_and_two_step_ownership() public {
        address cold = makeAddr("cold");
        address relay = makeAddr("relay");
        address nextOwner = makeAddr("nextOwner");
        address nextRelay = makeAddr("nextRelay");
        ArticleUnlockUsdc split = new ArticleUnlockUsdc(address(usdc), cold, relay);

        vm.prank(cold);
        split.setRelayer(nextRelay);
        assertEq(split.relayer(), nextRelay);

        vm.prank(relay);
        vm.expectRevert(ArticleUnlockUsdc.NotRelayer.selector);
        split.registerArticleFor(keccak256("after-rotate"), ONE_USD, publisher);

        vm.prank(cold);
        split.transferOwnership(nextOwner);
        assertEq(split.owner(), cold);
        vm.prank(nextOwner);
        split.acceptOwnership();
        assertEq(split.owner(), nextOwner);
        assertEq(split.pendingOwner(), address(0));

        vm.prank(cold);
        vm.expectRevert(ArticleUnlockUsdc.NotOwner.selector);
        split.setRelayer(relay);
    }

    function test_constructor_rejects_zero_addresses() public {
        vm.expectRevert(ArticleUnlockUsdc.InvalidToken.selector);
        new ArticleUnlockUsdc(address(0), address(this), address(this));
        vm.expectRevert(ArticleUnlockUsdc.InvalidAddress.selector);
        new ArticleUnlockUsdc(address(usdc), address(0), address(this));
        vm.expectRevert(ArticleUnlockUsdc.InvalidAddress.selector);
        new ArticleUnlockUsdc(address(usdc), address(this), address(0));
    }

    function test_stranger_cannot_accept_ownership() public {
        address cold = makeAddr("cold");
        ArticleUnlockUsdc split = new ArticleUnlockUsdc(address(usdc), cold, address(this));
        vm.prank(cold);
        split.transferOwnership(makeAddr("pending"));
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ArticleUnlockUsdc.NotOwner.selector);
        split.acceptOwnership();
    }
}
