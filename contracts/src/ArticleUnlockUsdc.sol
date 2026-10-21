// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ArticleUnlockUsdc
 * @notice Pay Circle USDC to unlock an article. Publisher receives USDC (no MON conversion).
 * @dev articleId = keccak256(bytes("your-article-slug")) — must match widget encoding.
 *      Article IDs are globally unique. Re-registration by a different publisher reverts.
 *      priceWei here means USDC base units (6 decimals): $1.00 = 1_000_000.
 *      Native MON is only needed for gas.
 *
 *      Roles match ArticleUnlock: owner (cold, two-step) sets the relayer and may
 *      emergency setActive or updatePrice. The relayer may only registerArticleFor.
 *      The server does not send updatePrice or setActive. Reader functions are unchanged.
 */
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

contract ArticleUnlockUsdc {
    struct Article {
        uint256 priceWei;
        address publisher;
        bool active;
    }

    address public owner;
    address public pendingOwner;
    /// @notice Server wallet allowed to call registerArticleFor. Not the owner.
    address public relayer;
    IERC20 public immutable usdc;

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
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RelayerUpdated(address indexed previousRelayer, address indexed newRelayer);

    error NotOwner();
    error NotRelayer();
    error InvalidAddress();
    error InvalidPublisher();
    error InvalidPrice();
    error InvalidToken();
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

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    /// @param usdcToken Circle USDC. Immutable.
    /// @param initialOwner Cold wallet. Cannot be the zero address.
    /// @param initialRelayer Hot wallet that will call registerArticleFor.
    constructor(address usdcToken, address initialOwner, address initialRelayer) {
        if (usdcToken == address(0)) revert InvalidToken();
        if (initialOwner == address(0) || initialRelayer == address(0)) revert InvalidAddress();
        owner = initialOwner;
        relayer = initialRelayer;
        usdc = IERC20(usdcToken);
        emit OwnershipTransferred(address(0), initialOwner);
        emit RelayerUpdated(address(0), initialRelayer);
    }

    /// @notice Start a two-step ownership transfer. `newOwner` must call acceptOwnership.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Finish a two-step ownership transfer. Caller must be pendingOwner.
    function acceptOwnership() external {
        if (pendingOwner == address(0) || msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// @notice Point registerArticleFor at a new server wallet. Owner only.
    function setRelayer(address newRelayer) external onlyOwner {
        if (newRelayer == address(0)) revert InvalidAddress();
        emit RelayerUpdated(relayer, newRelayer);
        relayer = newRelayer;
    }

    /// @notice Register an article you publish. Price in USDC base units (6 decimals).
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

    /// @notice Relayer registers on behalf of a publisher. Payments still go to `publisher`.
    ///         The owner cannot call this unless they are also the relayer.
    function registerArticleFor(
        bytes32 articleId,
        uint256 priceWei,
        address publisher
    ) external onlyRelayer {
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

    /// @notice Publisher or owner. The relayer may not call this.
    /// @dev The server never sends updatePrice. Writers sign it from their own wallet.
    ///      Keeping the relayer out means a hot wallet cannot reprice articles.
    function updatePrice(bytes32 articleId, uint256 priceWei) external {
        Article storage a = articles[articleId];
        if (a.publisher == address(0)) revert ArticleNotFound();
        if (msg.sender != a.publisher && msg.sender != owner) revert NotOwner();
        if (priceWei == 0) revert InvalidPrice();
        a.priceWei = priceWei;
        emit ArticleUpdated(articleId, priceWei);
    }

    /// @notice Publisher may toggle their own article. Owner may toggle any article
    ///         (emergency pause or resume). The relayer may not call this.
    /// @dev The server never sends setActive, so that call stays off the hot wallet.
    function setActive(bytes32 articleId, bool active) external {
        Article storage a = articles[articleId];
        if (a.publisher == address(0)) revert ArticleNotFound();
        if (msg.sender != a.publisher && msg.sender != owner) revert NotOwner();
        a.active = active;
    }

    /// @notice Pay USDC to unlock. Reader must `approve` this contract for at least priceWei.
    /// @dev Pulls exact registered price (not msg.value). Over-allowance is fine; only price is pulled.
    function unlock(bytes32 articleId) external {
        Article storage a = articles[articleId];
        if (a.publisher == address(0)) revert ArticleNotFound();
        if (!a.active) revert ArticleInactive();
        if (unlocked[articleId][msg.sender]) revert AlreadyUnlocked();

        uint256 price = a.priceWei;

        // Pull USDC first so a failed transfer cannot leave an unlock flag set.
        bool ok = usdc.transferFrom(msg.sender, a.publisher, price);
        if (!ok) revert TransferFailed();

        unlocked[articleId][msg.sender] = true;
        emit ArticleUnlocked(msg.sender, articleId, price, a.publisher);
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
