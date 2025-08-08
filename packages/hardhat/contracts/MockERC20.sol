// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockERC20 is ERC20, Ownable {
    uint8 _decimals = 18;
    constructor(string memory name, string memory symbol, uint8 decimals_)
        ERC20(name, symbol)
        Ownable(msg.sender) // Initialize Ownable with the deployer as the owner
    {
        _decimals = decimals_;
        _mint(msg.sender, 1_000_000 * (10**decimals_)); // Mint some tokens to deployer
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    function burn(uint256 amount) public { // Allow anyone to burn their own tokens
        _burn(msg.sender, amount);
    }
    function decimals() public view override returns (uint8) {
        return _decimals; // Standard ERC20 decimals (1e18)
    }
} 