import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";

const deployHedgeFundVaultWithMocks: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer, manager, feeCollector } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  // 1. Deploy Mock Tokens if on local or test network
  let usdtAddress: string;
  let fundTokenAddress: string;


    console.log("Deploying mock tokens for test network...");
    
    // Deploy Mock USDT (6 decimals)
    const mockUSDT = await deploy("MockUSDT", {
      from: deployer,
      args: ["Mock USDT", "USDT", 1],
      log: true,
      autoMine: true,
    });
    usdtAddress = mockUSDT.address;

    // Deploy Mock FundToken (18 decimals)
    const mockFundToken = await deploy("MockERC20", {
      from: deployer,
      args: ["Fund Token", "FUND", 1],
      log: true,
      autoMine: true,
    });
    fundTokenAddress = mockFundToken.address;

    console.log("✅ Mock tokens deployed:");
    console.log("MockUSDT:", usdtAddress);
    console.log("MockFundToken:", fundTokenAddress);

  // 2. Deploy HedgeFundVault with configuration
  const config = {
    managerAddress: manager || deployer, // Fallback to deployer if manager not set
    feeCollectorAddress: feeCollector || deployer, // Fallback to deployer if feeCollector not set
    initialTokenPrice: ethers.parseUnits("1.00", 1), // 1.00 USDT per 1e18 LP tokens
    managementFeeBps: 100, // 1% annual management fee
    performanceFeeBps: 2000, // 20% performance fee
    minDeposit: ethers.parseUnits("100", 1), // 1000 USDT minimum
    maxSingleDeposit: ethers.parseUnits("500000", 1), // 500k USDT maximum
    withdrawalDelay: 86400, // 1 day in seconds
  };

  console.log("Deploying HedgeFundVault with configuration:");
  console.log("USDT Address:", usdtAddress);
  console.log("FundToken Address:", fundTokenAddress);
  console.log("Manager:", config.managerAddress);
  // console.log("Manager:", deployer);
  console.log("Fee Collector:", config.feeCollectorAddress);

  const vault = await deploy("HedgeFundVault", {
    from: deployer,
    args: [
      usdtAddress,
      fundTokenAddress,
      config.managerAddress,
      config.feeCollectorAddress,
      config.initialTokenPrice,
    ],
    log: true,
    autoMine: true,
  });

  // 3. Initialize vault settings
  const vaultContract = await hre.ethers.getContractAt("HedgeFundVault", vault.address);
  
  console.log("Configuring vault settings...");
  await (await vaultContract.setFees(config.managementFeeBps, config.performanceFeeBps)).wait();
  await (await vaultContract.setDepositLimits(config.minDeposit, config.maxSingleDeposit)).wait();
  
  // For test networks, mint some initial USDT to deployer for testing
  if (hre.network.tags.test || hre.network.tags.local) {
    const mockUSDT = await hre.ethers.getContractAt("MockUSDT", usdtAddress);
    const mintAmount = ethers.parseUnits("1000000", 1); // 1M USDT
    console.log(`Minting ${ethers.formatUnits(mintAmount, 1)} USDT to deployer for testing...`);
    await (await mockUSDT.mint(deployer, mintAmount)).wait();
  }

  console.log("✅ HedgeFundVault deployment complete!");
  console.log("Vault Address:", vault.address);
  console.log("Initial Setup:");
  console.log("- Token Price:", await vaultContract.tokenPrice());
  // console.log("- Management Fee:", (await vaultContract.managementFeeBps()) / 100, "%");
  // console.log("- Performance Fee:", (await vaultContract.performanceFeeBps()) / 100, "%");
  console.log("- Min Deposit:", ethers.formatUnits(await vaultContract.minDeposit(), 6), "USDT");
  console.log("- Max Deposit:", ethers.formatUnits(await vaultContract.maxSingleDeposit(), 6), "USDT");
};

export default deployHedgeFundVaultWithMocks;

deployHedgeFundVaultWithMocks.tags = ["HedgeFundVault", "Mocks"];