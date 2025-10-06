import {
  ethers,
  parseUnits,
  formatUnits,
  ContractTransactionReceipt,
  EventLog,
  EthersError,
  NonceManager,
} from "ethers";
import { MulticallWrapper, MulticallProvider } from "ethers-multicall-provider";
import { HermesClient, PriceUpdate } from "@pythnetwork/hermes-client";
import IPythABI from "@pythnetwork/pyth-sdk-solidity/abis/IPyth.json";
import {
  fixDecimals,
  CreateVaultParamsStruct,
  calculateTokenAmounts,
  zeroBigNumber,
} from "./utils";
import { BlockchainConfig, BasicSettings, VaultData } from "./types";
import { readFileSync } from "fs";

import FactoryABI from "../abi/Factory.json";
import RouterABI from "../abi/Router.json";
import VaultABI from "../abi/Vault.json";
import IERC20ABI from "../abi/IERC20.json";
import CollateralPoolABI from "../abi/CollateralPool.json";
import VaultBatchManagerABI from "../abi/VaultBatchManager.json";

export class VaultManager {
  config: BlockchainConfig;
  basicSettings: BasicSettings;
  pythConnection: HermesClient;
  provider: MulticallProvider;
  signer: ethers.NonceManager;
  factory: ethers.Contract;
  router: ethers.Contract;
  vaultBatchManager: ethers.Contract;
  pythPriceFeed: ethers.Contract;

  constructor(config: BlockchainConfig, basicSettings: BasicSettings) {
    this.config = config;
    this.basicSettings = basicSettings;
    this.pythConnection = new HermesClient(basicSettings.hermesApiBaseUrl, {});
    this._checkWeb3Settings();
    this.provider = MulticallWrapper.wrap(
      new ethers.JsonRpcProvider(this.config.rpcNode),
    );
    this.signer = this._initializeWallet();
  }

  private _initializeWallet(): ethers.NonceManager {
    try {
      const walletJsonContent = readFileSync(
        `${process.cwd()}/${this.config.jsonWallet}`,
        "utf8",
      );
      const wallet = ethers.Wallet.fromEncryptedJsonSync(
        walletJsonContent,
        this.config.passphrase,
      );

      try {
        const connectedWallet = wallet.connect(this.provider);
        return new NonceManager(connectedWallet);
      } catch {
        throw new Error(`Failed to connect wallet to provider`);
      }
    } catch {
      throw new Error(`Wallet initialization failed`);
    }
  }

  _checkWeb3Settings() {
    if (!this.config.rpcNode) {
      throw new Error("rpcNode is not set");
    }
    if (!this.config.jsonWallet) {
      throw new Error("wallet path is not set");
    }
    if (!this.config.passphrase) {
      throw new Error("passphrase is not set");
    }
    if (!this.config.factory) {
      throw new Error("factory is not set");
    }
    if (!this.config.router) {
      throw new Error("router is not set");
    }
    if (!this.config.vaultBatchManager) {
      throw new Error("vaultBatchManager is not set");
    }
  }

  _checkTradingPairSettings(tradingPair: string) {
    if (!tradingPair) {
      throw new Error("tradingPair is not set");
    }
    if (!Object.keys(this.config.tradingPairs).includes(tradingPair)) {
      throw new Error("tradingPair is not valid");
    }
    if (!this.config.tradingPairs[tradingPair].baseToken) {
      throw new Error("baseToken is not set");
    }
    if (!this.config.tradingPairs[tradingPair].quoteToken) {
      throw new Error("quoteToken is not set");
    }
    if (!this.config.tradingPairs[tradingPair].priceFeed.decimals) {
      throw new Error("decimals is not set");
    }
  }

  async _getToken(tokenAddress: string) {
    return new ethers.Contract(tokenAddress, IERC20ABI, this.signer);
  }

  async _approveERC20(token: ethers.Contract, spender: string, amount: string) {
    const balance = await token.balanceOf(this.signer);
    if (balance < BigInt(amount)) {
      const tokenName = await token.name();
      throw new Error(`Insufficient ${tokenName} balance`);
    }
    const tx = await token.approve(spender, amount);
    await tx.wait();
  }

  async _getHermesPriceUpdateAtTimestamp(
    expiry: number,
    tradingPair: string,
  ): Promise<PriceUpdate> {
    if (
      !this.config.tradingPairs[tradingPair] ||
      !this.config.tradingPairs[tradingPair].priceFeed
    ) {
      throw `Pyth price feed for ${tradingPair} doesn't exist.`;
    }
    const pythPriceFeedId =
      this.config.tradingPairs[tradingPair].priceFeed.type == "PYTH" &&
      this.config.tradingPairs[tradingPair].priceFeed.id;

    // NOTE: There are two options:
    // * encoding: 'hex' or 'base64'. Default is 'hex'.
    // * parsed: default is true.
    // So we pass an empty object when getting price updates later.
    //
    // Ref: https://hermes.pyth.network/docs/#/rest/timestamp_price_updates
    let updatePriceData: PriceUpdate;

    if (expiry > Date.now() / 1000) {
      // NOTE: Special case for debugging goes here.
      // When we use a dummy expiry in the future to trigger the execution, so we
      // get the latest price update instead.
      updatePriceData = await this.pythConnection.getLatestPriceUpdates(
        [pythPriceFeedId],
        {},
      );
    } else {
      // NOTE: Normal case goes here.
      // Timestamp greater than current results in HTTP 404
      updatePriceData = await this.pythConnection.getPriceUpdatesAtTimestamp(
        expiry,
        [pythPriceFeedId],
        {},
      );
    }
    return updatePriceData;
  }

  async _getTradingPairOfVault(
    linkedToken: ethers.Contract,
    investmentToken: ethers.Contract,
    isBuyLow: boolean,
  ) {
    this.provider.isMulticallEnabled = true;
    const [linkedTokenName, investmentTokenName] = await Promise.all([
      linkedToken.symbol(),
      investmentToken.symbol(),
    ]);
    this.provider.isMulticallEnabled = false;

    return isBuyLow
      ? `${linkedTokenName}-${investmentTokenName}`
      : `${investmentTokenName}-${linkedTokenName}`;
  }

  async createVault(createVaultOptions) {
    const isBuyLow = !!createVaultOptions.isBuyLow;
    const useCollateralPool = !!createVaultOptions.useCollateralPool;
    const tradingPair = createVaultOptions.tradingPair;

    this._checkTradingPairSettings(tradingPair);

    const factory = new ethers.Contract(
      this.config.factory,
      FactoryABI,
      this.signer,
    );

    const baseTokenAddress = this.config.tradingPairs[tradingPair].baseToken;
    const quoteTokenAddress = this.config.tradingPairs[tradingPair].quoteToken;
    const baseToken = await this._getToken(baseTokenAddress);
    const quoteToken = await this._getToken(quoteTokenAddress);
    const linkedToken = isBuyLow ? baseToken : quoteToken;
    const investmentToken = isBuyLow ? quoteToken : baseToken;

    this.provider.isMulticallEnabled = true;
    const [baseTokenDecimals, quoteTokenDecimals] = await Promise.all([
      baseToken.decimals(),
      quoteToken.decimals(),
    ]);
    this.provider.isMulticallEnabled = false;

    const priceFeedDecimals = Number(
      this.config.tradingPairs[tradingPair].priceFeed.decimals,
    );

    const investmentTokenDecimals = isBuyLow
      ? quoteTokenDecimals
      : baseTokenDecimals;
    const linkedPriceDecimals =
      BigInt(fixDecimals) +
      BigInt(quoteTokenDecimals) -
      BigInt(baseTokenDecimals);

    const vaultParams: CreateVaultParamsStruct = {
      owner: await this.signer.getAddress(),
      baseToken: baseTokenAddress,
      quoteToken: quoteTokenAddress,
      expiry: createVaultOptions.expiry,
      linkedOraclePrice: parseUnits(
        createVaultOptions.linkedPrice,
        priceFeedDecimals,
      ).toString(),
      yieldValue: parseUnits(
        createVaultOptions.yieldPercentage,
        fixDecimals - 2,
      ).toString(),
      isBuyLow: isBuyLow,
      quantity: parseUnits(
        createVaultOptions.quantity,
        investmentTokenDecimals,
      ).toString(),
      useCollateralPool: useCollateralPool,
    };

    // Prepare for trading fee
    const linkedPriceBN = parseUnits(
      createVaultOptions.linkedPrice,
      linkedPriceDecimals,
    );
    const yieldValueBN = BigInt(vaultParams.yieldValue);
    const quantityBN = BigInt(vaultParams.quantity);

    const tradingFeeRateBN = (await factory.getPresetFeeParams())
      .tradingFeeRate;

    const pythPriceFeed = new ethers.Contract(
      this.config.pythPriceFeed,
      IPythABI,
      this.signer,
    );

    // Get data from price feed
    // NOTE: a dirty hack - we use a future time to get the latest price
    const updatePriceData = await this._getHermesPriceUpdateAtTimestamp(
      Date.now() / 1000 + 86400,
      tradingPair,
    );
    const updateData = updatePriceData && updatePriceData.binary.data;
    const binaryData = [updateData && Buffer.from(updateData[0], "hex")];

    // FIXME: any fractional amount could be converted to 1
    // In this case, we ask the LP to approve more than it requires.
    // Future works: we should derive a more accurate value.
    const priceRate = Math.ceil(
      parseFloat(updatePriceData.parsed[0].ema_price.price) /
        Math.pow(10, priceFeedDecimals),
    );
    const oraclePriceAtCreationBN = parseUnits(
      priceRate.toString(),
      linkedPriceDecimals,
    );

    // Approve spending
    if (!useCollateralPool) {
      const { linkedTokenAmount, investmentTokenAmount } =
        calculateTokenAmounts(
          quantityBN,
          yieldValueBN,
          isBuyLow,
          tradingFeeRateBN,
          oraclePriceAtCreationBN,
          linkedPriceBN,
        );

      const linkedTokenApproval = this._approveERC20(
        linkedToken,
        this.config.factory,
        linkedTokenAmount.toString(),
      );
      const investmentTokenApproval = this._approveERC20(
        investmentToken,
        this.config.factory,
        investmentTokenAmount.toString(),
      );

      await Promise.all([linkedTokenApproval, investmentTokenApproval]);
    }

    const updateFee = await pythPriceFeed.getUpdateFee(binaryData);

    const tx = await factory.createVault(vaultParams, binaryData, {
      value: updateFee,
      gasLimit: 3000000,
    });
    const result: ContractTransactionReceipt = await tx.wait();

    // Get vault address from event logs
    if (result.status == 1) {
      console.log("Vault created successfully");

      let parsedLog = null;
      for (const log of result.logs) {
        if (log instanceof EventLog) {
          parsedLog = factory.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });
          if (parsedLog.name == "VaultCreated") {
            break;
          }
        }
      }
      if (!parsedLog) {
        throw new Error("Vault creation event not found");
      }
      const vaultAddress = parsedLog.args.vaultAddress;
      console.log(`Vault address: ${vaultAddress}`);

      if (useCollateralPool) {
        console.log(
          "Waiting for blockchain state to settle before CollateralPool approval...",
        );
        await new Promise((resolve) => setTimeout(resolve, 3000));
        console.log(`Processing CollateralPool Approval for: ${vaultAddress}:`);
        const collateralPool = new ethers.Contract(
          this.config.collateralPool,
          CollateralPoolABI,
          this.signer,
        );

        // Retry CollateralPool approval
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const tx = await collateralPool.approveVault(vaultAddress, true);
            const result: ContractTransactionReceipt = await tx.wait();
            if (result.status !== 1) {
              throw new Error("CollateralPool approval failed");
            }
            console.log("CollateralPool approval succeeded!");
            break;
          } catch (retryError) {
            if (attempt === 3) throw retryError;

            console.log(
              `Attempt ${attempt + 1} failed, retrying in 2 seconds...`,
            );
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      }
    }
  }

  async adjustVaultYield(vaultAddress: string, yieldPercentage: string) {
    const yieldValue = parseUnits(yieldPercentage, fixDecimals - 2).toString();
    const vault = new ethers.Contract(vaultAddress, VaultABI, this.signer);
    const useCollateralPool = await vault.useCollateralPool();

    if (!useCollateralPool) {
      this.provider.isMulticallEnabled = true;
      const [
        isBuyLow,
        linkedTokenAddress,
        investmentTokenAddress,
        quantityRaw,
        depositTotalRaw,
        linkedPriceRaw,
        currentYieldValueRaw,
        tradingFeeRateRaw,
        oraclePriceAtCreationRaw,
      ] = await Promise.all([
        vault.isBuyLow(),
        vault.linkedToken(),
        vault.investmentToken(),
        vault.quantity(),
        vault.depositTotal(),
        vault.linkedPrice(),
        vault.yieldValue(),
        vault.tradingFeeRate(),
        vault.oraclePriceAtCreation(),
      ]);
      this.provider.isMulticallEnabled = false;

      const quantity = BigInt(quantityRaw);
      const depositTotal = BigInt(depositTotalRaw);
      const linkedPrice = BigInt(linkedPriceRaw);
      const currentYieldValue = BigInt(currentYieldValueRaw);
      const tradingFeeRate = BigInt(tradingFeeRateRaw);
      const oraclePriceAtCreation = BigInt(oraclePriceAtCreationRaw);

      const ownerDepositLinkedTokenAmount = BigInt(
        await vault.ownerDepositLinkedTokenAmount(),
      );
      const ownerDepositInvestmentTokenAmount = BigInt(
        await vault.ownerDepositInvestmentTokenAmount(),
      );

      const {
        linkedTokenAmount: currentDepositLinkedTokenAmount,
        investmentTokenAmount: currentDepositInvestmentTokenAmount,
      } = calculateTokenAmounts(
        depositTotal,
        currentYieldValue,
        isBuyLow,
        tradingFeeRate,
        oraclePriceAtCreation,
        linkedPrice,
      );
      const {
        linkedTokenAmount: remainingDepositLinkedTokenAmount,
        investmentTokenAmount: remainingDepositInvestmentTokenAmount,
      } = calculateTokenAmounts(
        quantity - depositTotal,
        BigInt(yieldValue),
        isBuyLow,
        tradingFeeRate,
        oraclePriceAtCreation,
        linkedPrice,
      );
      const newOwnerDepositLinkedTokenAmount =
        currentDepositLinkedTokenAmount + remainingDepositLinkedTokenAmount;
      const newOwnerDepositInvestmentTokenAmount =
        currentDepositInvestmentTokenAmount +
        remainingDepositInvestmentTokenAmount;

      // approve the difference
      if (newOwnerDepositLinkedTokenAmount > ownerDepositLinkedTokenAmount) {
        const linkedToken = await this._getToken(linkedTokenAddress);
        await this._approveERC20(
          linkedToken,
          vaultAddress,
          (
            newOwnerDepositLinkedTokenAmount - ownerDepositLinkedTokenAmount
          ).toString(),
        );
      }
      if (
        newOwnerDepositInvestmentTokenAmount > ownerDepositInvestmentTokenAmount
      ) {
        const investmentToken = await this._getToken(investmentTokenAddress);
        await this._approveERC20(
          investmentToken,
          vaultAddress,
          (
            newOwnerDepositInvestmentTokenAmount -
            ownerDepositInvestmentTokenAmount
          ).toString(),
        );
      }
    }

    try {
      const tx = await vault.adjustYieldValue(yieldValue);
      const result: ContractTransactionReceipt = await tx.wait();
      if (result.status == 1) {
        console.log(
          `Vault ${vaultAddress} yield adjusted to ${yieldPercentage}% successfully`,
        );
      } else {
        console.error(`Vault ${vaultAddress} yield adjust failed`);
      }
    } catch (error) {
      console.error(`Vault ${vaultAddress} yield adjust failed`);
      console.error((error as EthersError).shortMessage);
    }
  }

  async approveVault(vaultAddress: string, approve: boolean) {
    const collateralPool = new ethers.Contract(
      this.config.collateralPool,
      CollateralPoolABI,
      this.signer,
    );
    const vault = new ethers.Contract(vaultAddress, VaultABI, this.signer);

    try {
      const useCollateralPool = await vault.useCollateralPool();
      if (!useCollateralPool) {
        console.error(`Vault ${vaultAddress} is not using collateral pool`);
        return;
      }
      const tx = await collateralPool.approveVault(vaultAddress, approve);
      const result: ContractTransactionReceipt = await tx.wait();
      if (result.status == 1) {
        console.log(
          `CollateralPool ${approve ? "approval" : "disapproval"} for vault ${vaultAddress} succeeded!`,
        );
      } else {
        console.error(
          `CollateralPool ${approve ? "approval" : "disapproval"} for vault ${vaultAddress} failed!`,
        );
      }
    } catch (error) {
      console.error(
        `CollateralPool ${approve ? "approval" : "disapproval"} for vault ${vaultAddress} failed!`,
      );
      console.error((error as EthersError).shortMessage);
    }
  }

  async cancelVault(vaultAddress: string) {
    const vault = new ethers.Contract(vaultAddress, VaultABI, this.signer);

    try {
      const tx = await vault.lpCancel();
      const result: ContractTransactionReceipt = await tx.wait();

      if (result.status == 1) {
        console.log(`Vault ${vaultAddress} cancelled successfully`);
      } else {
        console.error(`Vault ${vaultAddress} cancelled failed`);
      }
    } catch (error) {
      console.error(`Vault ${vaultAddress} cancelled failed`);
      console.error((error as EthersError).shortMessage);
    }
  }

  async subscribeVault(vaultAddress: string, amount: string) {
    const vault = new ethers.Contract(vaultAddress, VaultABI, this.signer);
    this.provider.isMulticallEnabled = true;
    const [isBuyLow, investmentTokenAddress, linkedTokenAddress] =
      await Promise.all([
        vault.isBuyLow(),
        vault.investmentToken(),
        vault.linkedToken(),
      ]);
    this.provider.isMulticallEnabled = false;

    const linkedToken = await this._getToken(linkedTokenAddress);
    const investmentToken = await this._getToken(investmentTokenAddress);

    const investmentTokenDecimals = await investmentToken.decimals();
    const subscribeAmount = parseUnits(
      amount,
      investmentTokenDecimals,
    ).toString();
    await this._approveERC20(
      investmentToken,
      this.config.router,
      subscribeAmount,
    );

    // Get data from price feed
    const tradingPair = await this._getTradingPairOfVault(
      linkedToken,
      investmentToken,
      isBuyLow,
    );
    const updatePriceData = await this._getHermesPriceUpdateAtTimestamp(
      Date.now() / 1000 + 86400,
      tradingPair,
    );
    const pythPriceFeed = new ethers.Contract(
      this.config.pythPriceFeed,
      IPythABI,
      this.signer,
    );
    const updateData = updatePriceData && updatePriceData.binary.data;
    const binaryData = [updateData && Buffer.from(updateData[0], "hex")];
    const updateFee = await pythPriceFeed.getUpdateFee(binaryData);

    try {
      const router = new ethers.Contract(
        this.config.router,
        RouterABI,
        this.signer,
      );
      const tx = await router.deposit(
        vaultAddress,
        subscribeAmount,
        binaryData,
        { value: updateFee },
      );
      const result = await tx.wait();

      if (result.status == 1) {
        console.log(`Vault ${vaultAddress} subscribed successfully`);
      } else {
        console.error(`Vault ${vaultAddress} subscribed failed`);
      }
    } catch (error) {
      console.error(`Vault ${vaultAddress} subscribed failed`);
      console.error((error as EthersError).shortMessage);
    }
  }

  async withdrawVault(vaultAddress: string, checkOwner = false) {
    const account = await this.signer.getAddress();
    const vault = new ethers.Contract(vaultAddress, VaultABI, this.signer);

    this.provider.isMulticallEnabled = true;
    const [
      owner,
      expiry,
      isBuyLow,
      state,
      investmentTokenAddress,
      linkedTokenAddress,
    ] = await Promise.all([
      vault.owner(),
      vault.expiry(),
      vault.isBuyLow(),
      vault.state(),
      vault.investmentToken(),
      vault.linkedToken(),
    ]);
    this.provider.isMulticallEnabled = false;

    console.log(`Withdrawing vault ${vaultAddress}...`);
    if (Date.now() < Number(expiry) * 1000) {
      console.error(
        `Vault ${vaultAddress} is not yet available for withdrawal`,
      );
      return;
    }

    if (checkOwner && owner !== account) {
      console.error(
        `account ${account} is not the owner of the vault ${vaultAddress}`,
      );
      return;
    } else if (!checkOwner && owner === account) {
      console.error(
        `account ${account} is the owner of the vault ${vaultAddress}`,
      );
      return;
    }

    const linkedToken = await this._getToken(linkedTokenAddress);
    const investmentToken = await this._getToken(investmentTokenAddress);
    const tradingPair = await this._getTradingPairOfVault(
      linkedToken,
      investmentToken,
      isBuyLow,
    );
    const updatePriceData = await this._getHermesPriceUpdateAtTimestamp(
      expiry,
      tradingPair,
    );
    const pythPriceFeed = new ethers.Contract(
      this.config.pythPriceFeed,
      IPythABI,
      this.signer,
    );
    const updateData = updatePriceData && updatePriceData.binary.data;
    const binaryData = [updateData && Buffer.from(updateData[0], "hex")];
    const updateFee = await pythPriceFeed.getUpdateFee(binaryData);
    const getPriceOptions = {
      pythPublishTime: expiry,
      pythMinConfidenceRatio: 0,
      chainlinkUseLatestAnswer: false, // not used
      chainlinkRoundId: 0, // not used
    };

    let result = null;
    try {
      if (owner === account) {
        if (state == 1) {
          // Check investment token balance in the vault, if it's 0, then LP has withdrawn the vault
          const investmentTokenBalance =
            await investmentToken.balanceOf(vaultAddress);
          if (BigInt(investmentTokenBalance) == zeroBigNumber) {
            console.error(
              `LP has been withdrawn from the vault ${vaultAddress}`,
            );
            return;
          }
        } else if (state == 2) {
          // Check linked token balance in the vault, if it's 0, then LP has withdrawn the vault
          const linkedTokenBalance = await linkedToken.balanceOf(vaultAddress);
          if (BigInt(linkedTokenBalance) == zeroBigNumber) {
            console.error(
              `LP has been withdrawn from the vault ${vaultAddress}`,
            );
            return;
          }
        }
        const tx = await vault.lpWithdraw(binaryData, getPriceOptions, {
          value: updateFee,
        });
        result = await tx.wait();
      } else {
        // Check this.account balance in the vault, if it's 0, then subscriber has withdrawn the vault
        const balances = await vault.balances(account);
        if (BigInt(balances) == zeroBigNumber) {
          console.error(
            `account ${account} has no balance in the vault ${vaultAddress}`,
          );
          return;
        }
        const tx = await vault.withdraw(binaryData, getPriceOptions, {
          value: updateFee,
        });
        result = await tx.wait();
      }

      if (result.status == 1) {
        console.log(
          `Vault ${vaultAddress} withdrawn successfully by the ${owner === account ? "LP" : "subscriber"}`,
        );
      } else {
        console.error(
          `Vault ${vaultAddress} withdrawn failed by the ${owner === account ? "LP" : "subscriber"}`,
        );
      }
    } catch (error) {
      console.error(
        `Vault ${vaultAddress} withdrawn failed by the ${owner === account ? "LP" : "subscriber"}`,
      );
      console.error((error as EthersError).shortMessage);
    }
  }

  async groupVaultsByTradingPairAndExpiry(vaultData: VaultData[]) {
    const results = vaultData.map((vault) => {
      return {
        vault,
        key: `${vault.tradingPair}-${vault.expiry}${vault.isLp ? "-lp" : "-subscriber"}`,
        tradingPair: vault.tradingPair,
        expiry: vault.expiry,
        isLp: vault.isLp,
      };
    });

    // Group results
    const grouped: {
      [key: string]: {
        vaults: VaultData[];
        tradingPair: string;
        expiry: string;
        isLp: boolean;
      };
    } = {};
    results.forEach(({ vault, key, tradingPair, expiry, isLp }) => {
      if (!grouped[key]) {
        grouped[key] = {
          vaults: [],
          tradingPair,
          expiry,
          isLp,
        };
      }
      grouped[key].vaults.push(vault);
    });

    Object.keys(grouped).forEach((key) => {
      console.log(
        `Grouped ${grouped[key].vaults.length} vaults for ${grouped[key].tradingPair} at expiry ${grouped[key].expiry}`,
      );
    });
    return grouped;
  }

  async withdrawMultipleVaults(
    vaultAddresses: string[],
    checkOwner = false,
    bypassCheck = false,
  ) {
    console.log(
      `Start processing vaults withdrawal for ${checkOwner ? "LP" : "subscriber"}...`,
    );
    const vaultBatchManager = new ethers.Contract(
      this.config.vaultBatchManager,
      VaultBatchManagerABI,
      this.signer,
    );
    const pythPriceFeed = new ethers.Contract(
      this.config.pythPriceFeed,
      IPythABI,
      this.signer,
    );

    // Process vault withdrawal
    const processVaultGroup = async (
      vaults: string[],
      tradingPair: string,
      expiry: string,
      isLp: boolean,
    ) => {
      try {
        console.log(
          `Processing ${vaults.length} vaults for ${tradingPair} at expiry ${expiry}`,
        );
        const updatePriceData = await this._getHermesPriceUpdateAtTimestamp(
          parseInt(expiry.toString()),
          tradingPair,
        );

        const updateData = updatePriceData && updatePriceData.binary.data;
        const binaryData = [updateData && Buffer.from(updateData[0], "hex")];
        const singleUpdateFee = await pythPriceFeed.getUpdateFee(binaryData);
        const totalUpdateFee = BigInt(singleUpdateFee) * BigInt(vaults.length);
        console.log(
          `Single update fee: ${singleUpdateFee}, total update fee: ${totalUpdateFee}`,
        );

        const getPriceOptions = {
          pythPublishTime: parseInt(expiry),
          pythMinConfidenceRatio: 0,
          chainlinkUseLatestAnswer: false, // not used
          chainlinkRoundId: 0, // not used
        };

        let result = null;
        try {
          if (isLp) {
            const tx = await vaultBatchManager.lpWithdrawVaults(
              vaults,
              binaryData,
              getPriceOptions,
              {
                value: totalUpdateFee,
              },
            );
            result = await tx.wait();
          } else {
            const tx = await vaultBatchManager.withdrawVaults(
              vaults,
              binaryData,
              getPriceOptions,
              {
                value: totalUpdateFee,
              },
            );
            result = await tx.wait();
          }
          console.log(
            `Successfully withdrawn vaults, tx hash: ${result.hash}, vault addresses: ${vaults}`,
          );
          return true;
        } catch (error) {
          console.error(
            `Failed to withdraw vaults, vault addresses: ${vaults}`,
          );
          console.error((error as EthersError).shortMessage);
          return false;
        }
      } catch (error) {
        console.error(`Error processing vaults: ${error}`);
        return false;
      }
    };

    // If bypassCheck is true, directly process all vaults
    if (bypassCheck) {
      console.log(
        "Bypassing checks and grouping, processing all vaults together...",
      );

      // Get first vault info as reference using multicall
      const firstVault = new ethers.Contract(
        vaultAddresses[0],
        VaultABI,
        this.signer,
      );
      const account = await this.signer.getAddress();

      this.provider.isMulticallEnabled = true;
      const [
        expiry,
        owner,
        investmentTokenAddress,
        linkedTokenAddress,
        isBuyLow,
      ] = await Promise.all([
        firstVault.expiry(),
        firstVault.owner(),
        firstVault.investmentToken(),
        firstVault.linkedToken(),
        firstVault.isBuyLow(),
      ]);
      this.provider.isMulticallEnabled = false;

      const isLp = owner === account;
      const investmentToken = await this._getToken(investmentTokenAddress);
      const linkedToken = await this._getToken(linkedTokenAddress);
      const tradingPair = await this._getTradingPairOfVault(
        linkedToken,
        investmentToken,
        isBuyLow,
      );

      // Directly process all vaults
      await processVaultGroup(vaultAddresses, tradingPair, expiry, isLp);
      return;
    }

    // Check and filter vaults that are not yet available for withdrawal using multicall
    const filteredVaultData: VaultData[] = [];
    const account = await this.signer.getAddress();

    // Batch collect basic vault data using multicall
    const vaultContracts = vaultAddresses.map(
      (address) => new ethers.Contract(address, VaultABI, this.signer),
    );

    this.provider.isMulticallEnabled = true;
    const basicVaultData = await Promise.all(
      vaultContracts.map(async (vault) => {
        const [
          expiry,
          owner,
          investmentTokenAddress,
          linkedTokenAddress,
          isBuyLow,
          state,
          useCollateralPool,
          depositTotalRaw,
        ] = await Promise.all([
          vault.expiry(),
          vault.owner(),
          vault.investmentToken(),
          vault.linkedToken(),
          vault.isBuyLow(),
          vault.state(),
          vault.useCollateralPool(),
          vault.depositTotal(),
        ]);
        return {
          address: vault.target,
          expiry,
          owner,
          investmentTokenAddress,
          linkedTokenAddress,
          isBuyLow,
          state,
          useCollateralPool,
          depositTotalRaw,
        };
      }),
    );
    this.provider.isMulticallEnabled = false;

    // Process each vault with collected data
    for (let i = 0; i < vaultAddresses.length; i++) {
      const vaultAddress = vaultAddresses[i];
      const vaultData = basicVaultData[i];
      const vault = vaultContracts[i];

      if (Date.now() < Number(vaultData.expiry) * 1000) {
        console.error(
          `Skip vault ${vaultAddress}: vault is not yet available for withdrawal`,
        );
        continue;
      }

      if (checkOwner && vaultData.owner !== account) {
        console.error(
          `Skip vault ${vaultAddress}: account ${account} is not the owner of the vault`,
        );
        continue;
      } else if (!checkOwner && vaultData.owner === account) {
        console.error(
          `Skip vault ${vaultAddress}: account ${account} is the owner of the vault`,
        );
        continue;
      }

      const investmentToken = await this._getToken(
        vaultData.investmentTokenAddress,
      );
      const linkedToken = await this._getToken(vaultData.linkedTokenAddress);
      const tradingPair = await this._getTradingPairOfVault(
        linkedToken,
        investmentToken,
        vaultData.isBuyLow,
      );
      const isLp = vaultData.owner === account;
      if (isLp) {
        const depositTotal = BigInt(vaultData.depositTotalRaw);
        // If the vault is using collateral pool and no user deposit, then there's no locked vault for the lp to withdraw
        if (vaultData.useCollateralPool && depositTotal == zeroBigNumber) {
          console.error(
            `Skip vault ${vaultAddress}: no user deposit in the vault and the vault is using collateral pool`,
          );
          continue;
        }
        if (vaultData.state == 1) {
          const investmentTokenBalance =
            await investmentToken.balanceOf(vaultAddress);

          if (BigInt(investmentTokenBalance) == zeroBigNumber) {
            console.error(
              `Skip vault ${vaultAddress}: LP has been withdrawn from the vault`,
            );
            continue;
          }
        } else if (vaultData.state == 2) {
          const linkedTokenBalance = await linkedToken.balanceOf(vaultAddress);
          if (BigInt(linkedTokenBalance) == zeroBigNumber) {
            console.error(
              `Skip vault ${vaultAddress}: LP has been withdrawn from the vault`,
            );
            continue;
          }
        }
      } else {
        const balances = await vault.balances(account);
        if (BigInt(balances) == zeroBigNumber) {
          console.error(
            `Skip vault ${vaultAddress}: subscriber ${account} has no balance in the vault`,
          );
          continue;
        }
      }

      filteredVaultData.push({
        vault_address: vaultAddress,
        tradingPair,
        expiry: vaultData.expiry,
        isLp,
      });
    }

    const vaultsByPairAndExpiry =
      await this.groupVaultsByTradingPairAndExpiry(filteredVaultData);

    // Process each trading pair-expiry group
    for (const [groupKey, group] of Object.entries(vaultsByPairAndExpiry)) {
      console.log("=".repeat(100));
      console.log(
        `Processing group: ${groupKey} (${group.vaults.length} vaults)`,
      );
      console.log(
        `Vault addresses: ${JSON.stringify(group.vaults.map((v) => v.vault_address))}`,
      );

      await processVaultGroup(
        group.vaults.map((v) => v.vault_address),
        group.tradingPair,
        group.expiry,
        group.isLp,
      );
    }
  }

  async cancelMultipleVaults(vaultAddresses: string[], bypassCheck = false) {
    console.log("Start processing vaults cancellation for LP...");
    const vaultBatchManager = new ethers.Contract(
      this.config.vaultBatchManager,
      VaultBatchManagerABI,
      this.signer,
    );

    // If bypassCheck is true, directly cancel all vaults
    if (bypassCheck) {
      console.log(
        "Bypassing checks, directly cancelling all vaults together...",
      );

      try {
        const tx = await vaultBatchManager.lpCancelVaults(vaultAddresses);
        const result = await tx.wait();

        if (result.status == 1) {
          console.log(
            `Successfully cancelled vaults, tx hash: ${result.hash}, vault addresses: ${vaultAddresses}`,
          );
        } else {
          console.error(
            `Failed to cancel vaults, vault addresses: ${vaultAddresses}`,
          );
        }
      } catch (error) {
        console.error(
          `Failed to cancel vaults, vault addresses: ${vaultAddresses}`,
        );
        console.error((error as EthersError).shortMessage);
      }
      return;
    }

    // Check and filter vaults that can be cancelled
    const filteredVaultAddresses: string[] = [];
    const account = await this.signer.getAddress();

    // Batch collect basic vault data using multicall
    const vaultContracts = vaultAddresses.map(
      (address) => new ethers.Contract(address, VaultABI, this.signer),
    );

    this.provider.isMulticallEnabled = true;
    const basicVaultData = await Promise.all(
      vaultContracts.map(async (vault) => {
        const [owner, state, depositDeadline, lpCancelled] = await Promise.all([
          vault.owner(),
          vault.state(),
          vault.depositDeadline(),
          vault.lpCancelled(),
        ]);
        return {
          owner,
          state,
          depositDeadline,
          lpCancelled,
        };
      }),
    );
    this.provider.isMulticallEnabled = false;

    // Process each vault with collected data
    for (let i = 0; i < vaultAddresses.length; i++) {
      const vaultAddress = vaultAddresses[i];
      const vaultData = basicVaultData[i];

      // Check if the current account is the owner
      if (vaultData.owner !== account) {
        console.error(
          `Skip vault ${vaultAddress}: account ${account} is not the owner of the vault`,
        );
        continue;
      }

      // Check if vault is already cancelled
      if (vaultData.lpCancelled) {
        console.error(`Skip vault ${vaultAddress}: vault is already cancelled`);
        continue;
      }

      // Check if vault has been executed (state != 0)
      if (vaultData.state != 0) {
        console.error(
          `Skip vault ${vaultAddress}: vault has been executed and cannot be cancelled`,
        );
        continue;
      }

      // Check if vault has expired
      if (Date.now() >= Number(vaultData.depositDeadline) * 1000) {
        console.error(
          `Skip vault ${vaultAddress}: vault has expired and cannot be cancelled`,
        );
        continue;
      }

      filteredVaultAddresses.push(vaultAddress);
    }

    if (filteredVaultAddresses.length === 0) {
      console.log("No vaults to cancel after filtering.");
      return;
    }

    console.log(
      `Processing cancellation for ${filteredVaultAddresses.length} vaults: ${filteredVaultAddresses}`,
    );

    // Cancel all filtered vaults using batch manager
    try {
      const tx = await vaultBatchManager.lpCancelVaults(filteredVaultAddresses);
      const result = await tx.wait();

      if (result.status == 1) {
        console.log(
          `Successfully cancelled vaults, tx hash: ${result.hash}, vault addresses: ${filteredVaultAddresses}`,
        );
      } else {
        console.error(
          `Failed to cancel vaults, vault addresses: ${filteredVaultAddresses}`,
        );
      }
    } catch (error) {
      console.error(
        `Failed to cancel vaults, vault addresses: ${filteredVaultAddresses}`,
      );
      console.error((error as EthersError).shortMessage);
    }
  }

  async showConfig() {
    console.log(JSON.stringify(this.config, null, 2));
  }

  async listAllVaults(lpAddress: string) {
    const factory = new ethers.Contract(
      this.config.factory,
      FactoryABI,
      this.signer,
    );
    const vaults = await factory.getDeployedVaults();

    const lpVaultAddresses = (
      await Promise.all(
        vaults.map((vaultAddress: string) => {
          return (async () => {
            const vault = new ethers.Contract(
              vaultAddress,
              VaultABI,
              this.signer,
            );
            const owner = await vault.owner();
            return [owner, vaultAddress];
          })();
        }),
      )
    )
      .filter((arr: string[]) => arr[0] === lpAddress)
      .map((arr) => arr[1]);

    console.log(`Vaults owned by ${lpAddress}:`);
    console.log(lpVaultAddresses);
  }

  async showVault(vaultAddress: string) {
    const vault = new ethers.Contract(vaultAddress, VaultABI, this.signer);
    this.provider.isMulticallEnabled = true;
    const [
      linkedOraclePriceRaw,
      yieldValueRaw,
      isBuyLow,
      investmentTokenAddress,
      linkedTokenAddress,
      quantityRaw,
      state,
      expiry,
      depositTotalRaw,
    ] = await Promise.all([
      vault.linkedOraclePrice(),
      vault.yieldValue(),
      vault.isBuyLow(),
      vault.investmentToken(),
      vault.linkedToken(),
      vault.quantity(),
      vault.state(),
      vault.expiry(),
      vault.depositTotal(),
    ]);
    this.provider.isMulticallEnabled = false;

    const linkedOraclePrice = BigInt(linkedOraclePriceRaw);
    const yieldValue = BigInt(yieldValueRaw);
    const quantity = BigInt(quantityRaw);
    const depositTotal = BigInt(depositTotalRaw);

    const baseTokenAddress = isBuyLow
      ? linkedTokenAddress
      : investmentTokenAddress;

    const quoteTokenAddress = isBuyLow
      ? investmentTokenAddress
      : linkedTokenAddress;

    const tradingPairs = this.config.tradingPairs;
    const tradingPair = Object.keys(tradingPairs).find(
      (key) =>
        tradingPairs[key].baseToken === baseTokenAddress &&
        tradingPairs[key].quoteToken === quoteTokenAddress,
    );

    if (!tradingPair) {
      console.error("tradingPair not found in config");
      return;
    }

    const priceFeedDecimals = Number(
      tradingPairs[tradingPair].priceFeed.decimals,
    );

    const remainingQuantity = quantity - depositTotal;

    const investmentToken = await this._getToken(investmentTokenAddress);
    const investmentTokenDecimals = await investmentToken.decimals();
    const logs = await this.provider.getLogs({
      address: vaultAddress,
      fromBlock: 0,
      toBlock: "latest",
    });

    if (logs.length === 0) {
      throw new Error("Contract deployment transaction not found");
    }

    const creationLog = logs[0];
    const txHash = creationLog.transactionHash;
    const tx = await this.provider.getTransaction(txHash);
    const block = await this.provider.getBlock(tx.blockNumber);
    const timestamp = block.timestamp;
    const creationDate = new Date(Number(timestamp) * 1000);

    const result = {
      baseTokenAddress,
      quoteTokenAddress,
      linkedPrice: formatUnits(linkedOraclePrice, priceFeedDecimals),
      yieldValue: formatUnits(yieldValue, fixDecimals - 2),
      quantity: formatUnits(quantity, investmentTokenDecimals),
      remainingQuantity: formatUnits(
        remainingQuantity,
        investmentTokenDecimals,
      ),
      state,
      expiry: new Date(Number(expiry) * 1000),
      direction: isBuyLow ? "Buy Low" : "Sell High",
      creationDate,
    };

    console.log(`Base token address: ${result.baseTokenAddress}`);
    console.log(`Quote token address: ${result.quoteTokenAddress}`);
    console.log(`Linked Price: ${result.linkedPrice}`);
    console.log(`Yield: ${result.yieldValue}%`);
    console.log(`Creation Date: ${result.creationDate}`);
    console.log(`Expiry: ${result.expiry}`);
    console.log(`Direction: ${result.direction}`);
    console.log(`Quantity: ${result.quantity}`);
    console.log(`Remaining Quantity: ${result.remainingQuantity}`);
    console.log(`State: ${result.state}`);
  }
}
