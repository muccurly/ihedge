import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { HedgeFundVault, MockUSDT, MockERC20 } from "../typechain-types";
import { HedgeFundVault__factory, MockUSDT__factory, MockERC20__factory } from "../typechain-types";
describe("HedgeFundVault", function () {
  let owner: Signer;
  let manager: Signer;
  let feeCollector: Signer;
  let user: Signer;
  let other: Signer;
  let usdt: MockUSDT;
  let fundToken: MockERC20;
  let vault: HedgeFundVault;
  let initialTokenPrice = ethers.parseUnits("1", 6); // 1 USDT (6 decimals)

  beforeEach(async () => {
    [owner, manager, feeCollector, user, other] = await ethers.getSigners();
    // Деплой мока USDT (6 знаков)
    usdt = await new MockUSDT__factory(owner).deploy("MockUSDT", "USDT", 6);
    await usdt.waitForDeployment();
    // Деплой мока FundToken (18 знаков)
    fundToken = await new MockERC20__factory(owner).deploy("FundToken", "FUND", 18);
    await fundToken.waitForDeployment();
    // Деплой HedgeFundVault
    vault = await new HedgeFundVault__factory(owner).deploy(
      await usdt.getAddress(),
      await fundToken.getAddress(),
      await manager.getAddress(),
      await feeCollector.getAddress(),
      initialTokenPrice
    );
    await vault.waitForDeployment();
    // Даем USDT пользователю
    await usdt.connect(owner).mint(await user.getAddress(), ethers.parseUnits("1000000", 6));
    // Апрув на vault
    await usdt.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
    await fundToken.connect(owner).mint(await user.getAddress(), ethers.parseUnits("1000000", 18));
    await fundToken.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  describe("Деплой контракта", function () {
    it("Деплой с валидными параметрами", async function () {
      expect(await vault.usdtToken()).to.equal(await usdt.getAddress());
      expect(await vault.fundToken()).to.equal(await fundToken.getAddress());
      expect(await vault.manager()).to.equal(await manager.getAddress());
      expect(await vault.feeCollector()).to.equal(await feeCollector.getAddress());
      expect(await vault.tokenPrice()).to.equal(initialTokenPrice);
    });
    it("Деплой с нулевыми адресами вызывает revert", async function () {
      const HedgeFundVault = await ethers.getContractFactory("HedgeFundVault");
      await expect(
        HedgeFundVault.deploy(
          ethers.ZeroAddress,
          await fundToken.getAddress(),
          await manager.getAddress(),
          await feeCollector.getAddress(),
          initialTokenPrice
        )
      ).to.be.revertedWith("Zero USDT address");
      await expect(
        HedgeFundVault.deploy(
          await usdt.getAddress(),
          ethers.ZeroAddress,
          await manager.getAddress(),
          await feeCollector.getAddress(),
          initialTokenPrice
        )
      ).to.be.revertedWith("Zero FundToken address");
      await expect(
        HedgeFundVault.deploy(
          await usdt.getAddress(),
          await fundToken.getAddress(),
          ethers.ZeroAddress,
          await feeCollector.getAddress(),
          initialTokenPrice
        )
      ).to.be.revertedWith("Zero manager address");
      await expect(
        HedgeFundVault.deploy(
          await usdt.getAddress(),
          await fundToken.getAddress(),
          await manager.getAddress(),
          ethers.ZeroAddress,
          initialTokenPrice
        )
      ).to.be.revertedWith("Zero fee collector");
    });
  });

  describe("Депозит", function () {
    it("Успешный депозит", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await expect(vault.connect(user).deposit(depositAmount))
        .to.emit(vault, "Deposited")
        .withArgs(await user.getAddress(), depositAmount, anyValue);
      // Проверяем баланс LP
      expect(await fundToken.balanceOf(await user.getAddress())).to.be.gt(0);
    });
    it("Депозит ниже минимума вызывает revert", async function () {
      const minDeposit = await vault.minDeposit();
      await expect(vault.connect(user).deposit(minDeposit - 1n)).to.be.revertedWith("Below minimum");
    });
    it("Депозит выше максимума вызывает revert", async function () {
      const maxDeposit = await vault.maxSingleDeposit();
      await expect(vault.connect(user).deposit(maxDeposit + 1n)).to.be.revertedWith("Above maximum");
    });
    it("Депозит, когда депозиты отключены", async function () {
      await vault.connect(owner).toggleDeposits(false);
      const depositAmount = await vault.minDeposit();
      await expect(vault.connect(user).deposit(depositAmount)).to.be.revertedWith("Deposits disabled");
    });
    it("Депозит, когда контракт на паузе", async function () {
      await vault.connect(owner).pause();
      const depositAmount = await vault.minDeposit();
      await expect(vault.connect(user).deposit(depositAmount)).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });
  });

  describe("Запрос на вывод", function () {
    it("Успешный запрос на вывод", async function () {
      // Сначала депозит
      const depositAmount = ethers.parseUnits("10000", 6);
      await vault.connect(user).deposit(depositAmount);
      const lpAmountFromDeposit = (depositAmount * ethers.parseUnits("1", 18)) / await vault.tokenPrice();
      await fundToken.connect(user).approve(await vault.getAddress(), lpAmountFromDeposit);
      await expect(vault.connect(user).requestWithdrawal(lpAmountFromDeposit))
        .to.emit(vault, "WithdrawalRequested");
      // Проверяем, что LP токены переведены на контракт
      expect(await fundToken.balanceOf(await vault.getAddress())).to.equal(lpAmountFromDeposit);
    });
    it("Запрос с нулевым количеством вызывает revert", async function () {
      await expect(vault.connect(user).requestWithdrawal(0)).to.be.revertedWith("Zero amount");
    });
    it("Запрос с недостаточным балансом LP вызывает revert", async function () {
      // Запрашиваем больше LP токенов, чем у пользователя есть
      const userBalance = await fundToken.balanceOf(await user.getAddress());
      const excessiveAmount = userBalance + ethers.parseUnits("1000", 18);
      await expect(vault.connect(user).requestWithdrawal(excessiveAmount)).to.be.revertedWith("Insufficient balance");
    });
    it("Запрос, когда контракт на паузе", async function () {
      await vault.connect(owner).pause();
      await expect(vault.connect(user).requestWithdrawal(1)).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });
  });

  describe("Апрув вывода", function () {
    it("Успешный апрув вывода", async function () {
      // Депозит и запрос
      const depositAmount = ethers.parseUnits("10000", 6);
      await vault.connect(user).deposit(depositAmount);
      const lpAmountFromDeposit = (depositAmount * ethers.parseUnits("1", 18)) / await vault.tokenPrice();
      await fundToken.connect(user).approve(await vault.getAddress(), lpAmountFromDeposit);
      await vault.connect(user).requestWithdrawal(lpAmountFromDeposit);
      // Пропускаем время
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);
      await expect(vault.connect(manager).approveWithdrawal(0))
        .to.emit(vault, "WithdrawalApproved");
    });
    it("Апрув несуществующей заявки вызывает revert", async function () {
      await expect(vault.connect(manager).approveWithdrawal(999)).to.be.revertedWith("Invalid request");
    });
    it("Апрув уже апрувленной заявки вызывает revert", async function () {
      // Депозит и запрос
      const depositAmount = ethers.parseUnits("10000", 6);
      await vault.connect(user).deposit(depositAmount);
      const lpAmountFromDeposit = (depositAmount * ethers.parseUnits("1", 18)) / await vault.tokenPrice();
      await fundToken.connect(user).approve(await vault.getAddress(), lpAmountFromDeposit);
      await vault.connect(user).requestWithdrawal(lpAmountFromDeposit);
      // Пропускаем время
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);
      await vault.connect(manager).approveWithdrawal(0);
      await expect(vault.connect(manager).approveWithdrawal(0)).to.be.revertedWith("Already approved");
    });
    it("Апрув до истечения задержки вызывает revert", async function () {
      // Депозит и запрос
      const depositAmount = ethers.parseUnits("10000", 6);
      await vault.connect(user).deposit(depositAmount);
      const lpAmountFromDeposit = (depositAmount * ethers.parseUnits("1", 18)) / await vault.tokenPrice();
      await fundToken.connect(user).approve(await vault.getAddress(), lpAmountFromDeposit);
      await vault.connect(user).requestWithdrawal(lpAmountFromDeposit);
      await expect(vault.connect(manager).approveWithdrawal(0)).to.be.revertedWith("Too early");
    });
    it("Апрув не менеджером вызывает revert", async function () {
      await expect(vault.connect(user).approveWithdrawal(0)).to.be.revertedWith("Not manager");
    });
    it("Апрув, когда контракт на паузе", async function () {
      await vault.connect(owner).pause();
      await expect(vault.connect(manager).approveWithdrawal(0)).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });
  });

  describe("Процессинг вывода", function () {
    it("Успешный процессинг вывода", async function () {
      // Депозит, запрос, апрув
      const depositAmount = ethers.parseUnits("10000", 6);
      await vault.connect(user).deposit(depositAmount);
      
      // Выводим только те LP токены, которые получили за депозит
      const lpAmountFromDeposit = (depositAmount * ethers.parseUnits("1", 18)) / await vault.tokenPrice();
      await fundToken.connect(user).approve(await vault.getAddress(), lpAmountFromDeposit);
      await vault.connect(user).requestWithdrawal(lpAmountFromDeposit);
      
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);
      await vault.connect(manager).approveWithdrawal(0);
      
      await expect(vault.connect(user).processWithdrawal(0))
        .to.emit(vault, "WithdrawalProcessed");
      // Проверяем, что заявка помечена как claimed
      const req = await vault.withdrawalRequests(0);
      expect(req.claimed).to.be.true;
    });
    it("Процессинг чужой заявки вызывает revert", async function () {
      // Создаем заявку от user
      const depositAmount = ethers.parseUnits("10000", 6);
      await vault.connect(user).deposit(depositAmount);
      const lpAmountFromDeposit = (depositAmount * ethers.parseUnits("1", 18)) / await vault.tokenPrice();
      await fundToken.connect(user).approve(await vault.getAddress(), lpAmountFromDeposit);
      await vault.connect(user).requestWithdrawal(lpAmountFromDeposit);
      // Пытаемся обработать заявку от другого пользователя
      await expect(vault.connect(other).processWithdrawal(0)).to.be.revertedWith("Not your request");
    });
    it("Процессинг неапрувленной заявки вызывает revert", async function () {
      // Создаем заявку, но не апрувим её
      const depositAmount = ethers.parseUnits("10000", 6);
      await vault.connect(user).deposit(depositAmount);
      const lpAmountFromDeposit = (depositAmount * ethers.parseUnits("1", 18)) / await vault.tokenPrice();
      await fundToken.connect(user).approve(await vault.getAddress(), lpAmountFromDeposit);
      await vault.connect(user).requestWithdrawal(lpAmountFromDeposit);
      // Пытаемся обработать неапрувленную заявку
      await expect(vault.connect(user).processWithdrawal(0)).to.be.revertedWith("Not approved");
    });
    it("Процессинг уже обработанной заявки вызывает revert", async function () {
      // Депозит, запрос, апрув, процессинг
      const depositAmount = ethers.parseUnits("10000", 6);
      await vault.connect(user).deposit(depositAmount);
      const lpAmountFromDeposit = (depositAmount * ethers.parseUnits("1", 18)) / await vault.tokenPrice();
      await fundToken.connect(user).approve(await vault.getAddress(), lpAmountFromDeposit);
      await vault.connect(user).requestWithdrawal(lpAmountFromDeposit);
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);
      await vault.connect(manager).approveWithdrawal(0);
      await vault.connect(user).processWithdrawal(0);
      await expect(vault.connect(user).processWithdrawal(0)).to.be.revertedWith("Already claimed");
    });
  });

  describe("Фи (комиссии)", function () {
    it("Сбор комиссий через collectFees (прошло достаточно времени)", async function () {
      // Депозит
      const depositAmount = ethers.parseUnits("10000", 6);
      await vault.connect(user).deposit(depositAmount);
      
      // Проверяем, что есть AUM для расчета комиссий
      const aum = await vault.getAUM();
      expect(aum).to.be.gt(0);
      
      // Пропускаем 31 день
      await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);
      
      // Теперь должны быть комиссии для сбора
      const tx = vault.connect(manager).collectFees();
      await expect(tx).to.emit(vault, "FeesCollected");
    });
    it("Сбор комиссий, если прошло мало времени (ничего не происходит)", async function () {
      const tx = vault.connect(manager).collectFees();
      await expect(tx).to.not.emit(vault, "FeesCollected");
    });
  });

  describe("Админ-функции", function () {
    it("Смена менеджера (только owner)", async function () {
      await vault.connect(owner).updateManager(await other.getAddress());
      expect(await vault.manager()).to.equal(await other.getAddress());
    });
    it("Смена feeCollector (только owner)", async function () {
      await vault.connect(owner).updateFeeCollector(await other.getAddress());
      expect(await vault.feeCollector()).to.equal(await other.getAddress());
    });
    it("Изменение лимитов депозита (только owner)", async function () {
      await vault.connect(owner).setDepositLimits(100, 1000000);
      expect(await vault.minDeposit()).to.equal(100);
      expect(await vault.maxSingleDeposit()).to.equal(1000000);
    });
    it("Изменение комиссий (только owner, лимиты)", async function () {
      await vault.connect(owner).setFees(200, 2500);
      expect(await vault.managementFeeBps()).to.equal(200);
      expect(await vault.performanceFeeBps()).to.equal(2500);
      await expect(vault.connect(owner).setFees(600, 1000)).to.be.revertedWith("Management fee too high");
      await expect(vault.connect(owner).setFees(100, 4000)).to.be.revertedWith("Performance fee too high");
    });
    it("Отключение/включение депозитов (только owner)", async function () {
      await vault.connect(owner).toggleDeposits(false);
      expect(await vault.depositsEnabled()).to.be.false;
      await vault.connect(owner).toggleDeposits(true);
      expect(await vault.depositsEnabled()).to.be.true;
    });
    it("Экстренный вывод токенов (только owner)", async function () {
      const amount = ethers.parseUnits("1000", 6);
      await usdt.connect(owner).mint(await vault.getAddress(), amount);
      await expect(vault.connect(owner).emergencyWithdraw(await usdt.getAddress(), amount))
        .to.emit(vault, "EmergencyWithdrawn");
    });
  });

  describe("View-функции", function () {
    it("Проверка getAUM", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await vault.connect(user).deposit(depositAmount);
      // Проверяем AUM сразу после депозита, когда Vault держит USDT
      const aum = await vault.getAUM();
      expect(aum).to.be.gt(0);
      // Проверяем, что AUM примерно равен депозиту (с учетом tokenPrice)
      const expectedAum = (depositAmount * await vault.tokenPrice()) / ethers.parseUnits("1", 6);
      expect(aum).to.be.closeTo(expectedAum, expectedAum / 100n); // допуск 1%
    });
    it("Проверка getUserRequests", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await vault.connect(user).deposit(depositAmount);
      const lpAmountFromDeposit = (depositAmount * ethers.parseUnits("1", 18)) / await vault.tokenPrice();
      await fundToken.connect(user).approve(await vault.getAddress(), lpAmountFromDeposit);
      await vault.connect(user).requestWithdrawal(lpAmountFromDeposit);
      const requests = await vault.getUserRequests(await user.getAddress());
      expect(requests.length).to.be.gt(0);
    });
    it("Проверка getPendingRequests", async function () {
      const depositAmount = ethers.parseUnits("10000", 6);
      await vault.connect(user).deposit(depositAmount);
      const lpAmountFromDeposit = (depositAmount * ethers.parseUnits("1", 18)) / await vault.tokenPrice();
      await fundToken.connect(user).approve(await vault.getAddress(), lpAmountFromDeposit);
      await vault.connect(user).requestWithdrawal(lpAmountFromDeposit);
      const pending = await vault.getPendingRequests();
      expect(pending.length).to.be.gt(0);
    });
  });

  describe("Безопасность", function () {
    it("Проверка onlyOwner/onlyManager модификаторов", async function () {
      await expect(vault.connect(user).setFees(100, 1000)).to.be.reverted;
      await expect(vault.connect(user).updateManager(await user.getAddress())).to.be.reverted;
      await expect(vault.connect(user).updateFeeCollector(await user.getAddress())).to.be.reverted;
      await expect(vault.connect(user).setDepositLimits(1, 1)).to.be.reverted;
      await expect(vault.connect(user).toggleDeposits(false)).to.be.reverted;
      await expect(vault.connect(user).emergencyWithdraw(await usdt.getAddress(), 1)).to.be.reverted;
      await expect(vault.connect(user).approveWithdrawal(0)).to.be.revertedWith("Not manager");
    });
    it("Проверка ReentrancyGuard (повторный вызов processWithdrawal)", async function () {
      // Депозит, запрос, апрув, процессинг
      const depositAmount = ethers.parseUnits("10000", 6);
      await vault.connect(user).deposit(depositAmount);
      const lpAmountFromDeposit = (depositAmount * ethers.parseUnits("1", 18)) / await vault.tokenPrice();
      await fundToken.connect(user).approve(await vault.getAddress(), lpAmountFromDeposit);
      await vault.connect(user).requestWithdrawal(lpAmountFromDeposit);
      await ethers.provider.send("evm_increaseTime", [24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);
      await vault.connect(manager).approveWithdrawal(0);
      await vault.connect(user).processWithdrawal(0);
      await expect(vault.connect(user).processWithdrawal(0)).to.be.revertedWith("Already claimed");
    });
  });
});
