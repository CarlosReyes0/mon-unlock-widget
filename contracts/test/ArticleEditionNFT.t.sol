// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArticleEditionNFT} from "../src/ArticleEditionNFT.sol";

contract ReceiverStub {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0x150b7a02;
    }
}

contract RejectorStub {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xdeadbeef;
    }
}

contract ArticleEditionNFTTest is Test {
    ArticleEditionNFT nft;
    address writer = makeAddr("writer");
    address other = makeAddr("other");
    bytes32 articleId = keccak256("founder-manifesto");

    function setUp() public {
        nft = new ArticleEditionNFT("https://example.com/api/nft/");
    }

    function test_mint_is_one_of_one_and_sets_tokenURI() public {
        vm.prank(writer);
        uint256 tokenId = nft.mint(articleId);

        assertEq(tokenId, 1);
        assertEq(nft.totalSupply(), 1);
        assertEq(nft.ownerOf(1), writer);
        assertEq(nft.balanceOf(writer), 1);
        assertEq(nft.tokenOfArticle(articleId), 1);
        assertEq(nft.articleIdOf(1), articleId);
        assertEq(nft.tokenURI(1), "https://example.com/api/nft/1");
    }

    function test_revert_second_mint_same_article() public {
        vm.prank(writer);
        nft.mint(articleId);

        vm.prank(other);
        vm.expectRevert(ArticleEditionNFT.AlreadyMinted.selector);
        nft.mint(articleId);
    }

    function test_revert_zero_article_id() public {
        vm.prank(writer);
        vm.expectRevert(ArticleEditionNFT.InvalidArticle.selector);
        nft.mint(bytes32(0));
    }

    function test_distinct_articles_get_distinct_tokens() public {
        bytes32 second = keccak256("july-rain-walk");
        vm.prank(writer);
        uint256 a = nft.mint(articleId);
        vm.prank(other);
        uint256 b = nft.mint(second);
        assertEq(a, 1);
        assertEq(b, 2);
        assertEq(nft.ownerOf(2), other);
        assertEq(nft.tokenURI(2), "https://example.com/api/nft/2");
    }

    function test_transferFrom() public {
        vm.prank(writer);
        nft.mint(articleId);

        vm.prank(writer);
        nft.transferFrom(writer, other, 1);
        assertEq(nft.ownerOf(1), other);
        assertEq(nft.balanceOf(writer), 0);
        assertEq(nft.balanceOf(other), 1);
    }

    function test_safeTransferFrom_to_eoa() public {
        vm.prank(writer);
        nft.mint(articleId);
        vm.prank(writer);
        nft.safeTransferFrom(writer, other, 1);
        assertEq(nft.ownerOf(1), other);
    }

    function test_safeTransferFrom_to_receiver() public {
        ReceiverStub ok = new ReceiverStub();
        vm.prank(writer);
        nft.mint(articleId);
        vm.prank(writer);
        nft.safeTransferFrom(writer, address(ok), 1);
        assertEq(nft.ownerOf(1), address(ok));
    }

    function test_revert_safeTransferFrom_to_rejector() public {
        RejectorStub no = new RejectorStub();
        vm.prank(writer);
        nft.mint(articleId);
        vm.prank(writer);
        vm.expectRevert(ArticleEditionNFT.UnsafeRecipient.selector);
        nft.safeTransferFrom(writer, address(no), 1);
    }

    function test_approve_and_transfer() public {
        vm.prank(writer);
        nft.mint(articleId);
        vm.prank(writer);
        nft.approve(other, 1);
        assertEq(nft.getApproved(1), other);
        vm.prank(other);
        nft.transferFrom(writer, other, 1);
        assertEq(nft.ownerOf(1), other);
        assertEq(nft.getApproved(1), address(0));
    }

    function test_setApprovalForAll() public {
        vm.prank(writer);
        nft.mint(articleId);
        vm.prank(writer);
        nft.setApprovalForAll(other, true);
        vm.prank(other);
        nft.transferFrom(writer, other, 1);
        assertEq(nft.ownerOf(1), other);
    }

    function test_only_owner_sets_baseURI() public {
        vm.prank(other);
        vm.expectRevert(ArticleEditionNFT.NotOwner.selector);
        nft.setBaseURI("https://other.example/nft/");

        nft.setBaseURI("https://host/api/nft/");
        vm.prank(writer);
        nft.mint(articleId);
        assertEq(nft.tokenURI(1), "https://host/api/nft/1");
    }

    function test_supportsInterface() public view {
        assertTrue(nft.supportsInterface(0x01ffc9a7));
        assertTrue(nft.supportsInterface(0x80ac58cd));
        assertTrue(nft.supportsInterface(0x5b5e139f));
        assertFalse(nft.supportsInterface(0xffffffff));
    }

    function test_revert_ownerOf_unknown() public {
        vm.expectRevert(ArticleEditionNFT.NonexistentToken.selector);
        nft.ownerOf(1);
    }

    function test_name_and_symbol() public view {
        assertEq(nft.name(), "Open Paywall Edition");
        assertEq(nft.symbol(), "OPENART");
    }
}
