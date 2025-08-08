// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockUSDC is ERC20, Ownable {
    uint8 private _decimals = 6; // USDC имеет 6 знаков после запятой

    constructor(address initialOwner) ERC20("Mock USDC", "mUSDC") Ownable(initialOwner) {}

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    function burn(uint256 amount) public {
        _burn(msg.sender, amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    // Функция для совместимости с IWhitelistedToken
    function safeTransfer(address recipient, uint256 amount) external returns (bool) {
        return transfer(recipient, amount);
    }
} 