// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IUSDT {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function safeTransfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

interface IFundToken {
    function mint(address to, uint256 amount) external;
    function burn(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);

}

contract HedgeFundVault is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IUSDT;

    IUSDT public immutable usdtToken;
    IFundToken public immutable fundToken;

    // --- Pricing and Fees ---
    uint256 public tokenPrice; // Price per 1e18 LP tokens in USDT (6 decimals)
    uint256 public managementFeeBps; // Annual management fee in basis points (1% = 100bps)
    uint256 public performanceFeeBps; // Performance fee in basis points (20% = 2000bps)
    uint256 public highWaterMark; // High water mark for performance fees
    uint256 public lastFeeCollectionTime;

    // --- Withdrawal Process ---
    struct WithdrawalRequest {
        address user;
        uint256 lpAmount;
        uint256 usdtAmount;
        uint256 timestamp;
        bool approved;
        bool claimed;
    }

    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;
    uint256 public nextRequestId;
    mapping(address => uint256[]) public userRequests;
    uint256 public withdrawalDelay = 1 days; // Cooling-off period

    // --- Security ---
    address public manager;
    address public feeCollector;
    uint256 public maxSingleDeposit = 500_000 * 1e6; // 500k USDT
    uint256 public minDeposit = 1_000 * 1e6; // 1k USDT
    bool public depositsEnabled = true;

    // --- Events ---
    event Deposited(address indexed user, uint256 usdtAmount, uint256 lpMinted);
    event WithdrawalRequested(address indexed user, uint256 requestId, uint256 lpAmount);
    event WithdrawalApproved(uint256 indexed requestId);
    event WithdrawalProcessed(address indexed user, uint256 requestId, uint256 usdtAmount);
    event TokenPriceUpdated(uint256 newPrice);
    event FeesCollected(uint256 managementFee, uint256 performanceFee);
    event EmergencyWithdrawn(address token, uint256 amount);
    event WithdrawalCancelled(address indexed user, uint256 indexed requestId, uint256 lpAmount);

    // --- Modifiers ---
    modifier onlyManager() {
        require(msg.sender == manager, "Not manager");
        _;
    }

    constructor(
        address _usdtTokenAddress,
        address _fundTokenAddress,
        address _manager,
        address _feeCollector,
        uint256 _initialTokenPrice
    ) Ownable(msg.sender) {
        require(_usdtTokenAddress != address(0), "Zero USDT address");
        require(_fundTokenAddress != address(0), "Zero FundToken address");
        require(_manager != address(0), "Zero manager address");
        require(_feeCollector != address(0), "Zero fee collector");

        usdtToken = IUSDT(_usdtTokenAddress);
        fundToken = IFundToken(_fundTokenAddress);
        manager = _manager;
        feeCollector = _feeCollector;
        tokenPrice = _initialTokenPrice;
        managementFeeBps = 100; // 1%
        performanceFeeBps = 2000; // 20%
        lastFeeCollectionTime = block.timestamp;
    }

    // --- Core Functions ---

    function deposit(uint256 usdtAmount) external whenNotPaused nonReentrant {
        require(depositsEnabled, "Deposits disabled");
        require(usdtAmount >= minDeposit, "Below minimum");
        require(usdtAmount <= maxSingleDeposit, "Above maximum");

        _collectFeesIfNeeded();

        uint256 lpAmount = (usdtAmount * 1e18) / tokenPrice;
        require(lpAmount > 0, "Zero LP amount");
        require(lpAmount <= type(uint256).max / 1e18, "Overflow in LP calculation");

        usdtToken.transferFrom(msg.sender, address(this), usdtAmount);
        fundToken.mint(msg.sender, lpAmount);

        emit Deposited(msg.sender, usdtAmount, lpAmount);
    }

    function requestWithdrawal(uint256 lpAmount) external whenNotPaused nonReentrant {
        require(lpAmount > 0, "Zero amount");
        require(fundToken.balanceOf(msg.sender) >= lpAmount, "Insufficient balance");

        fundToken.transferFrom(msg.sender, address(this), lpAmount);

        uint256 requestId = nextRequestId++;
        uint256 usdtAmount = (lpAmount * tokenPrice) / 1e18;

        withdrawalRequests[requestId] = WithdrawalRequest({
            user: msg.sender,
            lpAmount: lpAmount,
            usdtAmount: usdtAmount,
            timestamp: block.timestamp,
            approved: false,
            claimed: false
        });

        userRequests[msg.sender].push(requestId);
        emit WithdrawalRequested(msg.sender, requestId, lpAmount);
    }

    function approveWithdrawal(uint256 requestId) external onlyManager whenNotPaused {
        WithdrawalRequest storage request = withdrawalRequests[requestId];
        require(request.user != address(0), "Invalid request");
        require(!request.approved, "Already approved");
        require(block.timestamp >= request.timestamp + withdrawalDelay, "Too early");

        request.approved = true;
        fundToken.burn(request.lpAmount);
        
        emit WithdrawalApproved(requestId);
    }

    function processWithdrawal(uint256 requestId) external nonReentrant {
        WithdrawalRequest storage request = withdrawalRequests[requestId];
        require(request.user != address(0), "Invalid request");
        require(request.user == msg.sender, "Not your request");
        require(request.approved, "Not approved");
        require(!request.claimed, "Already claimed");
        require(usdtToken.balanceOf(address(this)) >= request.usdtAmount, "Insufficient liquidity");

        request.claimed = true;
        usdtToken.safeTransfer(msg.sender, request.usdtAmount);

        emit WithdrawalProcessed(msg.sender, requestId, request.usdtAmount);
    }

    function cancelWithdrawal(uint256 requestId) external whenNotPaused {
        WithdrawalRequest storage request = withdrawalRequests[requestId];
        require(request.user != address(0), "Invalid request");
        require(request.user == msg.sender, "Not your request");
        require(!request.approved, "Already approved");
        require(!request.claimed, "Already claimed");

        // Возвращаем LP токены пользователю
        IERC20(address(fundToken)).transfer(msg.sender, request.lpAmount);
        
        // Удаляем заявку
        delete withdrawalRequests[requestId];
        
        emit WithdrawalCancelled(msg.sender, requestId, request.lpAmount);
    }

    // --- Fee Management ---
    function _collectFeesIfNeeded() internal {
        if (block.timestamp > lastFeeCollectionTime + 90 days) {
            collectFees();
        }
    }

    function collectFees() public {
        uint256 timeElapsed = block.timestamp - lastFeeCollectionTime;
        if (timeElapsed < 30 days) return;

        uint256 aum = usdtToken.balanceOf(address(this)) * tokenPrice / 1e6;
        uint256 managementFee = (aum * managementFeeBps * timeElapsed) / (365 days * 10000);
        
        uint256 performanceFee = 0;
        if (aum > highWaterMark) {
            performanceFee = (aum - highWaterMark) * performanceFeeBps / 10000;
            highWaterMark = aum;
        }

        lastFeeCollectionTime = block.timestamp;

        if (managementFee > 0 || performanceFee > 0) {
            uint256 totalFee = managementFee + performanceFee;
            uint256 feeInUsdt = (totalFee * 1e6) / tokenPrice;
            
            // Проверяем, что у Vault достаточно USDT для выплаты комиссий
            require(usdtToken.balanceOf(address(this)) >= feeInUsdt, "Insufficient USDT for fees");
            
            // Переводим комиссии в USDT, а не минтим LP токены
            usdtToken.safeTransfer(feeCollector, feeInUsdt);
            emit FeesCollected(managementFee, performanceFee);
        }
    }

    // --- Admin Functions ---
    function setTokenPrice(uint256 newPrice) external onlyManager {
        require(newPrice > 0, "Invalid price");
        tokenPrice = newPrice;
        emit TokenPriceUpdated(newPrice);
    }

    function setFees(uint256 _managementFeeBps, uint256 _performanceFeeBps) external onlyOwner {
        require(_managementFeeBps <= 500, "Management fee too high"); // Max 5%
        require(_performanceFeeBps <= 3000, "Performance fee too high"); // Max 30%
        managementFeeBps = _managementFeeBps;
        performanceFeeBps = _performanceFeeBps;
    }

    function setDepositLimits(uint256 _min, uint256 _max) external onlyOwner {
        minDeposit = _min;
        maxSingleDeposit = _max;
    }

    function toggleDeposits(bool enabled) external onlyOwner {
        depositsEnabled = enabled;
    }

    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner(), amount);
        emit EmergencyWithdrawn(token, amount);
    }

    function setWithdrawalDelay(uint256 _delay) external onlyOwner {
        require(_delay <= 7 days, "Delay too long"); // Максимум 7 дней
        withdrawalDelay = _delay;
    }

    // --- Security Features ---
    function updateManager(address newManager) external onlyOwner {
        require(newManager != address(0), "Zero address");
        manager = newManager;
    }

    function updateFeeCollector(address newCollector) external onlyOwner {
        require(newCollector != address(0), "Zero address");
        feeCollector = newCollector;
    }

    // --- Pause/Unpause ---
    function pause() external onlyOwner {
        _pause();
    }
    function unpause() external onlyOwner {
        _unpause();
    }

    // --- View Functions ---
    function getAUM() public view returns (uint256) {
        return usdtToken.balanceOf(address(this)) * tokenPrice / 1e6;
    }

    function getUserRequests(address user) external view returns (uint256[] memory) {
        return userRequests[user];
    }

    function getPendingRequests() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < nextRequestId; i++) {
            if (!withdrawalRequests[i].approved && !withdrawalRequests[i].claimed) {
                count++;
            }
        }

        uint256[] memory pending = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < nextRequestId; i++) {
            if (!withdrawalRequests[i].approved && !withdrawalRequests[i].claimed) {
                pending[index++] = i;
            }
        }
        return pending;
    }

    function getWithdrawalRequest(uint256 requestId) external view returns (
        address user,
        uint256 lpAmount,
        uint256 usdtAmount,
        uint256 timestamp,
        bool approved,
        bool claimed
    ) {
        WithdrawalRequest storage request = withdrawalRequests[requestId];
        return (
            request.user,
            request.lpAmount,
            request.usdtAmount,
            request.timestamp,
            request.approved,
            request.claimed
        );
    }
}