// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract BerezkaStableCoinManager is Ownable2Step {
    using SafeERC20 for IERC20;

    // Whitelist стабильных монет
    mapping(address => bool) public whitelist;
    
    // Массив всех whitelisted токенов для удобства
    address[] public whitelistedTokens;
    
    // События
    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);
    event TokensAdded(address[] tokens);
    event TokensRemoved(address[] tokens);

    modifier isWhitelisted(address _targetToken) {
        require(whitelist[_targetToken], "INVALID_TOKEN_TO_DEPOSIT");
        _;
    }

    constructor() Ownable(msg.sender) {}

    // Добавляет токен в whitelist
    function addWhitelistToken(address _token) external onlyOwner {
        require(_token != address(0), "Zero address");
        require(!whitelist[_token], "Token already whitelisted");
        
        whitelist[_token] = true;
        whitelistedTokens.push(_token);
        
        emit TokenAdded(_token);
    }

    // Удаляет токен из whitelist
    function removeWhitelistToken(address _token) external onlyOwner {
        require(whitelist[_token], "Token not whitelisted");
        
        whitelist[_token] = false;
        
        // Удаляем из массива
        for (uint256 i = 0; i < whitelistedTokens.length; i++) {
            if (whitelistedTokens[i] == _token) {
                whitelistedTokens[i] = whitelistedTokens[whitelistedTokens.length - 1];
                whitelistedTokens.pop();
                break;
            }
        }
        
        emit TokenRemoved(_token);
    }

    // Добавляет несколько токенов в whitelist
    function addWhitelistTokens(address[] memory _tokens) external onlyOwner {
        for (uint256 i = 0; i < _tokens.length; i++) {
            if (_tokens[i] != address(0) && !whitelist[_tokens[i]]) {
                whitelist[_tokens[i]] = true;
                whitelistedTokens.push(_tokens[i]);
            }
        }
        
        emit TokensAdded(_tokens);
    }

    // Удаляет несколько токенов из whitelist
    function removeWhitelistTokens(address[] memory _tokens) external onlyOwner {
        for (uint256 i = 0; i < _tokens.length; i++) {
            if (whitelist[_tokens[i]]) {
                whitelist[_tokens[i]] = false;
                
                // Удаляем из массива
                for (uint256 j = 0; j < whitelistedTokens.length; j++) {
                    if (whitelistedTokens[j] == _tokens[i]) {
                        whitelistedTokens[j] = whitelistedTokens[whitelistedTokens.length - 1];
                        whitelistedTokens.pop();
                        break;
                    }
                }
            }
        }
        
        emit TokensRemoved(_tokens);
    }

    // Проверяет, является ли токен whitelisted
    function isTokenWhitelisted(address _token) external view returns (bool) {
        return whitelist[_token];
    }

    // Возвращает все whitelisted токены
    function getAllWhitelistedTokens() external view returns (address[] memory) {
        return whitelistedTokens;
    }

    // Возвращает количество whitelisted токенов
    function getWhitelistedTokensCount() external view returns (uint256) {
        return whitelistedTokens.length;
    }

    // Получает токен по индексу
    function getWhitelistedTokenByIndex(uint256 _index) external view returns (address) {
        require(_index < whitelistedTokens.length, "Index out of bounds");
        return whitelistedTokens[_index];
    }

    // Безопасный перевод токенов (только для whitelisted токенов)
    function safeTransfer(
        address _token,
        address _to,
        uint256 _amount
    ) external onlyOwner isWhitelisted(_token) {
        IERC20(_token).safeTransfer(_to, _amount);
    }

    // Безопасный перевод токенов от имени (только для whitelisted токенов)
    function safeTransferFrom(
        address _token,
        address _from,
        address _to,
        uint256 _amount
    ) external onlyOwner isWhitelisted(_token) {
        IERC20(_token).safeTransferFrom(_from, _to, _amount);
    }
} 