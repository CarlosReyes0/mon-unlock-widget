// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ArticleUnlock
 * @notice Pay native MON to unlock an article. Phase 1 — Monad testnet.
 * @dev articleId = keccak256(bytes("your-article-slug")) — must match widget encoding.
 *      Article IDs are globally unique. Re-registration by a different publisher reverts.
 */
contract ArticleUnlock {
    struct Article {
        uint256 priceWei;
        address publisher;
        bool active;
    }

    address public owner;

    mapping(bytes32 => Article) public articles;
    mapping(bytes32 => mapping(address => bool)) public unlocked;

    event ArticleRegistered(
        bytes32 indexed articleId,
        uint256 priceWei,
        address indexed publisher
    );
    event ArticleUpdated(bytes32 indexed articleId, uint256 priceWei);
    event ArticleUnlocked(
        address indexed reader,
        bytes32 indexed articleId,
        uint256 amount,
        address indexed publisher
    );

    error NotOwner();
    error InvalidPublisher();
    error InvalidPrice();
    error ArticleNotFound();
    error ArticleInactive();
    error AlreadyUnlocked();
    error InsufficientPayment();
    error TransferFailed();
    /// @notice Article id is already owned by another publisher.
    error ArticleTaken(address publisher);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Register an article you publish. Price in wei (1 MON = 1e18 wei).
    /// @dev Same publisher may update price by re-registering; another publisher cannot take over.
    function registerArticle(bytes32 articleId, uint256 priceWei) external {
        if (priceWei == 0) revert InvalidPrice();
        address existing = articles[articleId].publisher;
        if (existing != address(0) && existing != msg.sender) {
            revert ArticleTaken(existing);
        }
        articles[articleId] = Article({
            priceWei: priceWei,
            publisher: msg.sender,
            active: true
        });
        emit ArticleRegistered(articleId, priceWei, msg.sender);
    }

    /// @notice Owner can register on behalf of a publisher (bootstrap / demo setup).
    function registerArticleFor(
        bytes32 articleId,
        uint256 priceWei,
        address publisher
    ) external onlyOwner {
        if (priceWei == 0) revert InvalidPrice();
        if (publisher == address(0)) revert InvalidPublisher();
        address existing = articles[articleId].publisher;
        if (existing != address(0) && existing != publisher) {
            revert ArticleTaken(existing);
        }
        articles[articleId] = Article({
            priceWei: priceWei,
            publisher: publisher,
            active: true
        });
        emit ArticleRegistered(articleId, priceWei, publisher);
    }

    function updatePrice(bytes32 articleId, uint256 priceWei) external {
        Article storage a = articles[articleId];
        if (a.publisher == address(0)) revert ArticleNotFound();
        if (msg.sender != a.publisher && msg.sender != owner) revert NotOwner();
        if (priceWei == 0) revert InvalidPrice();
        a.priceWei = priceWei;
        emit ArticleUpdated(articleId, priceWei);
    }

    function setActive(bytes32 articleId, bool active) external {
        Article storage a = articles[articleId];
        if (a.publisher == address(0)) revert ArticleNotFound();
        if (msg.sender != a.publisher && msg.sender != owner) revert NotOwner();
        a.active = active;
    }

    /// @notice Pay MON to unlock. Overpayment is forwarded to publisher (no refund in MVP).
    function unlock(bytes32 articleId) external payable {
        Article storage a = articles[articleId];
        if (a.publisher == address(0)) revert ArticleNotFound();
        if (!a.active) revert ArticleInactive();
        if (unlocked[articleId][msg.sender]) revert AlreadyUnlocked();
        if (msg.value < a.priceWei) revert InsufficientPayment();

        unlocked[articleId][msg.sender] = true;

        (bool ok, ) = a.publisher.call{value: msg.value}("");
        if (!ok) revert TransferFailed();

        emit ArticleUnlocked(msg.sender, articleId, msg.value, a.publisher);
    }

    function hasUnlocked(address reader, bytes32 articleId) external view returns (bool) {
        return unlocked[articleId][reader];
    }

    function getArticle(
        bytes32 articleId
    ) external view returns (uint256 priceWei, address publisher, bool active) {
        Article storage a = articles[articleId];
        return (a.priceWei, a.publisher, a.active);
    }

    /// @dev Helpers for scripts — same encoding as keccak256(bytes(string)) in JS/viem.
    function articleIdFromString(string calldata slug) external pure returns (bytes32) {
        return keccak256(bytes(slug));
    }
}
