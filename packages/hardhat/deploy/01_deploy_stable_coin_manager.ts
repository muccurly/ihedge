import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  console.log("Deploying BerezkaStableCoinManager...");

  const stableCoinManager = await deploy("BerezkaStableCoinManager", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
  });

  console.log("BerezkaStableCoinManager deployed to:", stableCoinManager.address);

  // Добавляем USDT в whitelist (если есть MockUSDT)
  try {
    const mockUSDT = await hre.deployments.get("MockUSDT");
    const stableCoinManagerContract = await hre.ethers.getContract("BerezkaStableCoinManager");
    
    console.log("Adding MockUSDT to whitelist...");
    await stableCoinManagerContract.addWhitelistToken(mockUSDT.address);
    console.log("MockUSDT added to whitelist");
  } catch {
    console.log("MockUSDT not found, skipping whitelist addition");
  }

  // Добавляем USDC в whitelist (если есть MockUSDC)
  try {
    const mockUSDC = await hre.deployments.get("MockUSDC");
    const stableCoinManagerContract = await hre.ethers.getContract("BerezkaStableCoinManager");
    
    console.log("Adding MockUSDC to whitelist...");
    await stableCoinManagerContract.addWhitelistToken(mockUSDC.address);
    console.log("MockUSDC added to whitelist");
  } catch {
    console.log("MockUSDC not found, skipping whitelist addition");
  }
};

func.id = "deploy_stable_coin_manager";
func.tags = ["BerezkaStableCoinManager"];

export default func; 