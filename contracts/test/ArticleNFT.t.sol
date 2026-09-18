// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArticleNFT} from "../src/ArticleNFT.sol";
import {ArticleUnlock} from "../src/ArticleUnlock.sol";
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

contract ArticleNFTTest is Test {
    ArticleNFT nft;
    ArticleUnlock unlockMon;
    ArticleUnlockUsdc unlockUsdc;
    MockUsdc usdc;

    address writer = makeAddr("writer");
    address reader = makeAddr("reader");
    address other = makeAddr("other");
    string constant SLUG = "july-rain-walk";
    bytes32 articleId;

    function setUp() public {
        usdc = new MockUsdc();
        unlockMon = new ArticleUnlock();
        unlockUsdc = new ArticleUnlockUsdc(address(usdc));
        nft = new ArticleNFT(address(unlockMon), address(unlockUsdc), "https://example.test/nft/");
        articleId = keccak256(bytes(SLUG));

        vm.prank(writer);
        unlockUsdc.registerArticle(articleId, 500_000);
        vm.prank(writer);
        unlockMon.registerArticle(articleId, 1 ether);
    }

    function _unlockReaderUsdc() internal {
        usdc.mint(reader, 500_000);
        vm.startPrank(reader);
        usdc.approve(address(unlockUsdc), 500_000);
        unlockUsdc.unlock(articleId);
        vm.stopPrank();
    }

    function test_writer_mints_edition_one_of_one() public {
        vm.prank(writer);
        uint256 id = nft.mintEdition(SLUG, 1);
        assertEq(id, 1);
        assertEq(nft.balanceOf(writer, id), 1);
        assertEq(nft.editionOf(articleId), 1);
        assertEq(nft.tokenRole(id), nft.ROLE_EDITION());
        assertEq(nft.uri(id), "https://example.test/nft/1");
        (bytes32 storedId, uint8 role, string memory slug, uint256 supply) = nft.tokenMeta(id);
        assertEq(storedId, articleId);
        assertEq(role, 0);
        assertEq(slug, SLUG);
        assertEq(supply, 1);
    }

    function test_writer_mints_small_edition() public {
        vm.prank(writer);
        uint256 id = nft.mintEdition(SLUG, 5);
        assertEq(nft.balanceOf(writer, id), 5);
        assertEq(nft.tokenSupply(id), 5);
    }

    function test_writer_can_add_copies_up_to_max() public {
        vm.startPrank(writer);
        nft.mintEdition(SLUG, 20);
        nft.mintEdition(SLUG, 5);
        vm.stopPrank();
        assertEq(nft.tokenSupply(1), 25);
        vm.prank(writer);
        vm.expectRevert(ArticleNFT.InvalidAmount.selector);
        nft.mintEdition(SLUG, 1);
    }

    function test_non_publisher_cannot_mint_edition() public {
        vm.prank(other);
        vm.expectRevert(ArticleNFT.NotPublisher.selector);
        nft.mintEdition(SLUG, 1);
    }

    function test_reader_mints_receipt_after_usdc_unlock() public {
        _unlockReaderUsdc();
        vm.prank(reader);
        uint256 id = nft.mintReceipt(SLUG);
        assertEq(id, 1);
        assertEq(nft.balanceOf(reader, id), 1);
        assertEq(nft.tokenRole(id), nft.ROLE_RECEIPT());
        assertEq(nft.receiptOf(articleId, reader), id);
    }

    function test_receipt_after_native_mon_unlock() public {
        vm.deal(reader, 2 ether);
        vm.prank(reader);
        unlockMon.unlock{value: 1 ether}(articleId);
        vm.prank(reader);
        uint256 id = nft.mintReceipt(SLUG);
        assertEq(nft.tokenRole(id), 1);
        assertEq(nft.balanceOf(reader, id), 1);
    }

    function test_receipt_reverts_without_unlock() public {
        vm.prank(reader);
        vm.expectRevert(ArticleNFT.NotUnlocked.selector);
        nft.mintReceipt(SLUG);
    }

    function test_one_receipt_per_reader() public {
        _unlockReaderUsdc();
        vm.startPrank(reader);
        nft.mintReceipt(SLUG);
        vm.expectRevert(ArticleNFT.AlreadyMinted.selector);
        nft.mintReceipt(SLUG);
        vm.stopPrank();
    }

    function test_empty_slug_reverts() public {
        vm.prank(writer);
        vm.expectRevert(ArticleNFT.EmptySlug.selector);
        nft.mintEdition("", 1);
    }

    function test_edition_and_receipt_share_contract_distinct_ids() public {
        vm.prank(writer);
        uint256 editionId = nft.mintEdition(SLUG, 1);
        _unlockReaderUsdc();
        vm.prank(reader);
        uint256 receiptId = nft.mintReceipt(SLUG);
        assertEq(editionId, 1);
        assertEq(receiptId, 2);
        assertEq(nft.tokenRole(editionId), 0);
        assertEq(nft.tokenRole(receiptId), 1);
    }

    function test_nft_is_not_required_to_unlock() public {
        _unlockReaderUsdc();
        assertTrue(unlockUsdc.hasUnlocked(reader, articleId));
        assertEq(nft.receiptOf(articleId, reader), 0);
    }

    function test_owner_can_set_base_uri() public {
        nft.setBaseURI("https://host/api/article-nfts/metadata/");
        vm.prank(writer);
        nft.mintEdition(SLUG, 1);
        assertEq(nft.uri(1), "https://host/api/article-nfts/metadata/1");
    }

    function test_non_owner_cannot_set_contracts() public {
        vm.prank(other);
        vm.expectRevert(ArticleNFT.NotOwner.selector);
        nft.setUnlockContracts(address(0), address(unlockUsdc));
    }

    function test_safe_transfer() public {
        vm.prank(writer);
        uint256 id = nft.mintEdition(SLUG, 2);
        vm.prank(writer);
        nft.safeTransferFrom(writer, other, id, 1, "");
        assertEq(nft.balanceOf(writer, id), 1);
        assertEq(nft.balanceOf(other, id), 1);
    }

    function test_supports_erc1155_interface() public view {
        assertTrue(nft.supportsInterface(0xd9b67a26));
        assertTrue(nft.supportsInterface(0x0e89341c));
        assertTrue(nft.supportsInterface(0x01ffc9a7));
        assertFalse(nft.supportsInterface(0xffffffff));
    }
}
