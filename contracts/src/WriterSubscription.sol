// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title WriterSubscription
 * @notice Reader pays Circle USDC each period to subscribe to one writer.
 *         First month is pulled on subscribe(). Later months: anyone may call
 *         renew() while the reader still has USDC allowance.
 *         cancel() drops access immediately (does not refund).
 */
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract WriterSubscription {
    uint256 public constant PERIOD = 30 days;

    struct Plan {
        uint256 priceUsdc;
        bool offered;
    }

    struct Sub {
        uint256 expiresAt;
        bool canceled;
    }

    IERC20 public immutable usdc;
    address public owner;

    mapping(address => Plan) public plans;
    /// writer => reader => sub
    mapping(address => mapping(address => Sub)) public subs;

    event PlanSet(address indexed writer, uint256 priceUsdc);
    event Subscribed(address indexed reader, address indexed writer, uint256 amount, uint256 expiresAt);
    event Renewed(address indexed reader, address indexed writer, uint256 amount, uint256 expiresAt);
    event Canceled(address indexed reader, address indexed writer);

    error NotOwner();
    error InvalidWriter();
    error InvalidToken();
    error InvalidPrice();
    error PlanNotOffered();
    error AlreadyActive();
    error NotActive();
    error TooEarly();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address usdcToken) {
        if (usdcToken == address(0)) revert InvalidToken();
        usdc = IERC20(usdcToken);
        owner = msg.sender;
    }

    function setPlan(uint256 priceUsdc) external {
        if (priceUsdc == 0) {
            plans[msg.sender] = Plan({priceUsdc: 0, offered: false});
        } else {
            plans[msg.sender] = Plan({priceUsdc: priceUsdc, offered: true});
        }
        emit PlanSet(msg.sender, priceUsdc);
    }

    function subscribe(address writer) external {
        if (writer == address(0)) revert InvalidWriter();
        Plan memory plan = plans[writer];
        if (!plan.offered || plan.priceUsdc == 0) revert PlanNotOffered();

        Sub storage sub = subs[writer][msg.sender];
        if (hasActiveSubscription(msg.sender, writer)) revert AlreadyActive();

        bool ok = usdc.transferFrom(msg.sender, writer, plan.priceUsdc);
        if (!ok) revert TransferFailed();

        uint256 expiresAt = block.timestamp + PERIOD;
        sub.expiresAt = expiresAt;
        sub.canceled = false;
        emit Subscribed(msg.sender, writer, plan.priceUsdc, expiresAt);
    }

    /// @notice Permissionless renew. Pulls the current plan price from the reader.
    function renew(address writer, address reader) external {
        if (writer == address(0) || reader == address(0)) revert InvalidWriter();
        Plan memory plan = plans[writer];
        if (!plan.offered || plan.priceUsdc == 0) revert PlanNotOffered();

        Sub storage sub = subs[writer][reader];
        if (sub.canceled) revert NotActive();
        if (sub.expiresAt == 0) revert NotActive();
        if (block.timestamp < sub.expiresAt) revert TooEarly();

        bool ok = usdc.transferFrom(reader, writer, plan.priceUsdc);
        if (!ok) revert TransferFailed();

        uint256 expiresAt = block.timestamp + PERIOD;
        sub.expiresAt = expiresAt;
        emit Renewed(reader, writer, plan.priceUsdc, expiresAt);
    }

    function cancel(address writer) external {
        Sub storage sub = subs[writer][msg.sender];
        if (sub.expiresAt == 0 && !sub.canceled) revert NotActive();
        sub.canceled = true;
        sub.expiresAt = block.timestamp;
        emit Canceled(msg.sender, writer);
    }

    function hasActiveSubscription(address reader, address writer) public view returns (bool) {
        Sub memory sub = subs[writer][reader];
        if (sub.canceled) return false;
        return sub.expiresAt > block.timestamp;
    }

    function getPlan(address writer) external view returns (uint256 priceUsdc, bool offered) {
        Plan memory plan = plans[writer];
        return (plan.priceUsdc, plan.offered);
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert InvalidWriter();
        owner = next;
    }
}
