// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ArticleEditionNFT
 * @notice Optional 1/1 collectible of an Open Paywall article (Base).
 * @dev articleId = keccak256(bytes(slug)) — same encoding as ArticleUnlock.
 *      Unlock / USDC pricing stays the access gate. This token is provenance only.
 */
interface IERC721Receiver {
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}

contract ArticleEditionNFT {
    string public constant name = "Open Paywall Edition";
    string public constant symbol = "OPENART";

    address public owner;
    string public baseURI;
    uint256 public totalSupply;

    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) private _balanceOf;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    /// @notice tokenId for an article (0 = not minted). tokenIds start at 1.
    mapping(bytes32 => uint256) public tokenOfArticle;
    mapping(uint256 => bytes32) public articleIdOf;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed spender, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event EditionMinted(address indexed to, uint256 indexed tokenId, bytes32 indexed articleId);
    event BaseURISet(string baseURI);

    error NotOwner();
    error AlreadyMinted();
    error InvalidArticle();
    error NonexistentToken();
    error NotAuthorized();
    error InvalidRecipient();
    error UnsafeRecipient();
    error InvalidAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(string memory initialBaseURI) {
        owner = msg.sender;
        baseURI = initialBaseURI;
    }

    /// @notice Mint the 1/1 edition for this article to the caller.
    function mint(bytes32 articleId) external returns (uint256 tokenId) {
        if (articleId == bytes32(0)) revert InvalidArticle();
        if (tokenOfArticle[articleId] != 0) revert AlreadyMinted();

        tokenId = ++totalSupply;
        tokenOfArticle[articleId] = tokenId;
        articleIdOf[tokenId] = articleId;
        _mint(msg.sender, tokenId);
        emit EditionMinted(msg.sender, tokenId, articleId);
    }

    function setBaseURI(string calldata next) external onlyOwner {
        baseURI = next;
        emit BaseURISet(next);
    }

    function tokenURI(uint256 tokenId) public view returns (string memory) {
        if (_ownerOf[tokenId] == address(0)) revert NonexistentToken();
        return string.concat(baseURI, _toString(tokenId));
    }

    function balanceOf(address account) public view returns (uint256) {
        if (account == address(0)) revert InvalidAddress();
        return _balanceOf[account];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address tokenOwner = _ownerOf[tokenId];
        if (tokenOwner == address(0)) revert NonexistentToken();
        return tokenOwner;
    }

    function approve(address spender, uint256 tokenId) public {
        address tokenOwner = ownerOf(tokenId);
        if (spender == tokenOwner) revert InvalidRecipient();
        if (msg.sender != tokenOwner && !isApprovedForAll(tokenOwner, msg.sender)) {
            revert NotAuthorized();
        }
        _tokenApprovals[tokenId] = spender;
        emit Approval(tokenOwner, spender, tokenId);
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        if (_ownerOf[tokenId] == address(0)) revert NonexistentToken();
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) public {
        if (operator == msg.sender) revert InvalidAddress();
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address account, address operator) public view returns (bool) {
        return _operatorApprovals[account][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) public {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) public {
        _transfer(from, to, tokenId);
        _checkOnERC721Received(from, to, tokenId, data);
    }

    function supportsInterface(bytes4 interfaceId) public pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC165
            interfaceId == 0x80ac58cd || // ERC721
            interfaceId == 0x5b5e139f; // ERC721Metadata
    }

    function _mint(address to, uint256 tokenId) internal {
        if (to == address(0)) revert InvalidRecipient();
        _ownerOf[tokenId] = to;
        _balanceOf[to] += 1;
        emit Transfer(address(0), to, tokenId);
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address tokenOwner = _ownerOf[tokenId];
        return
            spender == tokenOwner ||
            spender == _tokenApprovals[tokenId] ||
            _operatorApprovals[tokenOwner][spender];
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        if (to == address(0)) revert InvalidRecipient();
        address tokenOwner = ownerOf(tokenId);
        if (tokenOwner != from) revert NotAuthorized();
        if (!_isApprovedOrOwner(msg.sender, tokenId)) revert NotAuthorized();

        delete _tokenApprovals[tokenId];
        _balanceOf[from] -= 1;
        _balanceOf[to] += 1;
        _ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function _checkOnERC721Received(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) internal {
        if (to.code.length == 0) return;
        try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (
            bytes4 retval
        ) {
            if (retval != IERC721Receiver.onERC721Received.selector) revert UnsafeRecipient();
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
