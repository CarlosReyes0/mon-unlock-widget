// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ArticleNFT
 * @notice Optional ERC-1155 souvenirs for Open Paywall articles on Monad.
 *         Unlock remains access — holding this token is never required to read.
 *         Writer editions (1/1 or small supply) and reader receipts share this contract.
 *
 * @dev User-wallet mint: msg.sender pays gas and receives the token.
 *      Edition: publisher of the article on ArticleUnlock / ArticleUnlockUsdc.
 *      Receipt: reader who already hasUnlocked on either unlock contract.
 *      tokenURI is a metadata URL (title, teaser, OG image) — never the paid body.
 */
interface IArticleUnlock {
    function getArticle(bytes32 articleId)
        external
        view
        returns (uint256 priceWei, address publisher, bool active);

    function hasUnlocked(address reader, bytes32 articleId) external view returns (bool);
}

interface IERC1155Receiver {
    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) external returns (bytes4);

    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external returns (bytes4);
}

contract ArticleNFT {
    uint8 public constant ROLE_EDITION = 0;
    uint8 public constant ROLE_RECEIPT = 1;
    uint256 public constant MAX_EDITION_SUPPLY = 25;

    bytes4 private constant ERC165_ID = 0x01ffc9a7;
    bytes4 private constant ERC1155_ID = 0xd9b67a26;
    bytes4 private constant ERC1155_METADATA_ID = 0x0e89341c;
    bytes4 private constant ERC1155_RECEIVED = 0xf23a6e61;
    bytes4 private constant ERC1155_BATCH_RECEIVED = 0xbc197c81;

    address public owner;
    address public unlockMon;
    address public unlockUsdc;
    string public baseURI;
    uint256 public nextId = 1;

    mapping(address => mapping(uint256 => uint256)) public balanceOf;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    mapping(uint256 => bytes32) public tokenArticleId;
    mapping(uint256 => uint8) public tokenRole;
    mapping(uint256 => string) public tokenSlug;
    mapping(uint256 => uint256) public tokenSupply;

    mapping(bytes32 => uint256) public editionOf;
    mapping(bytes32 => mapping(address => uint256)) public receiptOf;

    event TransferSingle(
        address indexed operator,
        address indexed from,
        address indexed to,
        uint256 id,
        uint256 value
    );
    event TransferBatch(
        address indexed operator,
        address indexed from,
        address indexed to,
        uint256[] ids,
        uint256[] values
    );
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);
    event URI(string value, uint256 indexed id);
    event ArticleNftMinted(
        uint256 indexed tokenId,
        bytes32 indexed articleId,
        address indexed to,
        uint8 role,
        uint256 amount,
        string slug
    );
    event UnlockContractsUpdated(address unlockMon, address unlockUsdc);
    event BaseURIUpdated(string baseURI);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPublisher();
    error NotUnlocked();
    error InvalidAmount();
    error InvalidAddress();
    error EmptySlug();
    error AlreadyMinted();
    error NotToken();
    error NotAuthorized();
    error InsufficientBalance();
    error LengthMismatch();
    error UnsafeRecipient();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address unlockMon_, address unlockUsdc_, string memory baseURI_) {
        owner = msg.sender;
        unlockMon = unlockMon_;
        unlockUsdc = unlockUsdc_;
        baseURI = baseURI_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit UnlockContractsUpdated(unlockMon_, unlockUsdc_);
        emit BaseURIUpdated(baseURI_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setUnlockContracts(address unlockMon_, address unlockUsdc_) external onlyOwner {
        unlockMon = unlockMon_;
        unlockUsdc = unlockUsdc_;
        emit UnlockContractsUpdated(unlockMon_, unlockUsdc_);
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        baseURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    /// @notice Writer mint. `amount` is 1 (1/1) or a small edition (max 25). Minter pays gas.
    function mintEdition(string calldata slug, uint256 amount) external returns (uint256 tokenId) {
        if (bytes(slug).length == 0) revert EmptySlug();
        if (amount == 0 || amount > MAX_EDITION_SUPPLY) revert InvalidAmount();

        bytes32 articleId = keccak256(bytes(slug));
        if (_publisherOf(articleId) != msg.sender) revert NotPublisher();

        tokenId = editionOf[articleId];
        if (tokenId == 0) {
            tokenId = nextId++;
            editionOf[articleId] = tokenId;
            tokenArticleId[tokenId] = articleId;
            tokenRole[tokenId] = ROLE_EDITION;
            tokenSlug[tokenId] = slug;
        } else if (tokenSupply[tokenId] + amount > MAX_EDITION_SUPPLY) {
            revert InvalidAmount();
        }

        _mint(msg.sender, tokenId, amount);
        emit ArticleNftMinted(tokenId, articleId, msg.sender, ROLE_EDITION, amount, slug);
    }

    /// @notice Reader receipt after a successful on-chain unlock. Minter pays gas. One per wallet.
    function mintReceipt(string calldata slug) external returns (uint256 tokenId) {
        if (bytes(slug).length == 0) revert EmptySlug();

        bytes32 articleId = keccak256(bytes(slug));
        if (!_hasUnlocked(articleId, msg.sender)) revert NotUnlocked();
        if (receiptOf[articleId][msg.sender] != 0) revert AlreadyMinted();

        tokenId = nextId++;
        receiptOf[articleId][msg.sender] = tokenId;
        tokenArticleId[tokenId] = articleId;
        tokenRole[tokenId] = ROLE_RECEIPT;
        tokenSlug[tokenId] = slug;

        _mint(msg.sender, tokenId, 1);
        emit ArticleNftMinted(tokenId, articleId, msg.sender, ROLE_RECEIPT, 1, slug);
    }

    function uri(uint256 id) public view returns (string memory) {
        if (tokenArticleId[id] == bytes32(0) && tokenSupply[id] == 0) revert NotToken();
        return string.concat(baseURI, _toString(id));
    }

    function tokenMeta(uint256 id)
        external
        view
        returns (bytes32 articleId, uint8 role, string memory slug, uint256 supply)
    {
        if (tokenArticleId[id] == bytes32(0) && tokenSupply[id] == 0) revert NotToken();
        return (tokenArticleId[id], tokenRole[id], tokenSlug[id], tokenSupply[id]);
    }

    function balanceOfBatch(
        address[] calldata accounts,
        uint256[] calldata ids
    ) external view returns (uint256[] memory) {
        if (accounts.length != ids.length) revert LengthMismatch();
        uint256[] memory batch = new uint256[](accounts.length);
        for (uint256 i; i < accounts.length; i++) {
            batch[i] = balanceOf[accounts[i]][ids[i]];
        }
        return batch;
    }

    function setApprovalForAll(address operator, bool approved) external {
        if (operator == address(0)) revert InvalidAddress();
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes calldata data
    ) external {
        if (to == address(0)) revert InvalidAddress();
        if (from != msg.sender && !isApprovedForAll[from][msg.sender]) revert NotAuthorized();
        if (balanceOf[from][id] < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from][id] -= amount;
            balanceOf[to][id] += amount;
        }
        emit TransferSingle(msg.sender, from, to, id, amount);
        _onReceived(from, to, id, amount, data);
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) external {
        if (to == address(0)) revert InvalidAddress();
        if (ids.length != amounts.length) revert LengthMismatch();
        if (from != msg.sender && !isApprovedForAll[from][msg.sender]) revert NotAuthorized();
        for (uint256 i; i < ids.length; i++) {
            if (balanceOf[from][ids[i]] < amounts[i]) revert InsufficientBalance();
            unchecked {
                balanceOf[from][ids[i]] -= amounts[i];
                balanceOf[to][ids[i]] += amounts[i];
            }
        }
        emit TransferBatch(msg.sender, from, to, ids, amounts);
        _onBatchReceived(from, to, ids, amounts, data);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == ERC165_ID ||
            interfaceId == ERC1155_ID ||
            interfaceId == ERC1155_METADATA_ID;
    }

    function articleIdFromString(string calldata slug) external pure returns (bytes32) {
        return keccak256(bytes(slug));
    }

    function _publisherOf(bytes32 articleId) internal view returns (address) {
        address fromUsdc = _publisherOn(unlockUsdc, articleId);
        if (fromUsdc != address(0)) return fromUsdc;
        return _publisherOn(unlockMon, articleId);
    }

    function _publisherOn(address unlock, bytes32 articleId) internal view returns (address) {
        if (unlock == address(0)) return address(0);
        try IArticleUnlock(unlock).getArticle(articleId) returns (uint256, address publisher, bool) {
            return publisher;
        } catch {
            return address(0);
        }
    }

    function _hasUnlocked(bytes32 articleId, address reader) internal view returns (bool) {
        if (_unlockedOn(unlockUsdc, articleId, reader)) return true;
        return _unlockedOn(unlockMon, articleId, reader);
    }

    function _unlockedOn(address unlock, bytes32 articleId, address reader) internal view returns (bool) {
        if (unlock == address(0)) return false;
        try IArticleUnlock(unlock).hasUnlocked(reader, articleId) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }

    function _mint(address to, uint256 id, uint256 amount) internal {
        if (to == address(0)) revert InvalidAddress();
        balanceOf[to][id] += amount;
        tokenSupply[id] += amount;
        emit TransferSingle(msg.sender, address(0), to, id, amount);
        _onReceived(address(0), to, id, amount, "");
    }

    function _onReceived(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) internal {
        if (to.code.length == 0) return;
        try IERC1155Receiver(to).onERC1155Received(msg.sender, from, id, amount, data) returns (
            bytes4 magic
        ) {
            if (magic != ERC1155_RECEIVED) revert UnsafeRecipient();
        } catch {
            revert UnsafeRecipient();
        }
    }

    function _onBatchReceived(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal {
        if (to.code.length == 0) return;
        try IERC1155Receiver(to).onERC1155BatchReceived(msg.sender, from, ids, amounts, data) returns (
            bytes4 magic
        ) {
            if (magic != ERC1155_BATCH_RECEIVED) revert UnsafeRecipient();
        } catch {
            revert UnsafeRecipient();
        }
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
