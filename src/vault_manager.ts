import {
  ethers,
  parseUnits,
  formatUnits,
  ContractTransactionReceipt,
  EventLog,
  EthersError,
  NonceManager,
} from "ethers";
import { HermesClient, PriceUpdate } from "@pythnetwork/hermes-client";
import IPythABI from "@pythnetwork/pyth-sdk-solidity/abis/IPyth.json";
import {
  fixDecimals,
  fixDecimalsBigNumber,
  CreateVaultParamsStruct,
  calculateTradingFee,
  zeroBigNumber,
} from "./utils";
import { BlockchainConfig, BasicSettings } from "./types";
import { readFileSync } from "fs";

import FactoryABI from "../abi/Factory.json";
import RouterABI from "../abi/Router.json";
import VaultABI from "../abi/Vault.json";
import IERC20ABI from "../abi/IERC20.json";
import CollateralPoolABI from "../abi/CollateralPool.json";

export class VaultManager {
  config: BlockchainConfig;
  basicSettings: BasicSettings;
  pythConnection: HermesClient;
  provider: ethers.JsonRpcProvider;
  signer: ethers.NonceManager;
  factory: ethers.Contract;
  router: ethers.Contract;
  pythPriceFeed: ethers.Contract;

  constructor(config: BlockchainConfig, basicSettings: BasicSettings) {
    this.config = config;
    this.basicSettings = basicSettings;
    this.pythConnection = new HermesClient(basicSettings.hermesApiBaseUrl, {});
    this._checkWeb3Settings();
    this.provider = new ethers.JsonRpcProvider(this.config.rpcNode);
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

  async _getTokenDecimals(tokenAddress: string): Promise<string> {
    const token = new ethers.Contract(tokenAddress, IERC20ABI, this.signer);
    return await token.decimals();
  }

  async _approveERC20(tokenAddress: string, spender: string, amount: string) {
    const token = new ethers.Contract(tokenAddress, IERC20ABI, this.signer);
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

  async _getTradingPairOfVault(vaultAddress: string) {
    const vault = new ethers.Contract(vaultAddress, VaultABI, this.signer);

    const isBuyLow = await vault.isBuyLow();
    const investmentTokenAddress = await vault.investmentToken();
    const linkedTokenAddress = await vault.linkedToken();

    const investmentToken = await this._getToken(investmentTokenAddress);
    const linkedToken = await this._getToken(linkedTokenAddress);

    const investmentTokenName = await investmentToken.symbol();
    const linkedTokenName = await linkedToken.symbol();

    return isBuyLow
      ? `${linkedTokenName}-${investmentTokenName}`
      : `${investmentTokenName}-${linkedTokenName}`;
  }

  async createVault(createVaultOptions) {
    const isBuyLow = !!createVaultOptions.isBuyLow;
    const useCollateralPool = !!createVaultOptions.useCollateralPool;
    const tradingPair = createVaultOptions.tradingPair;

    this._checkTradingPairSettings(tradingPair);

    const priceFeedDecimals = Number(
      this.config.tradingPairs[tradingPair].priceFeed.decimals,
    );
    const quoteTokenDecimals = await this._getTokenDecimals(
      this.config.tradingPairs[tradingPair].quoteToken,
    );
    const baseTokenDecimals = await this._getTokenDecimals(
      this.config.tradingPairs[tradingPair].baseToken,
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
      baseToken: this.config.tradingPairs[tradingPair].baseToken,
      quoteToken: this.config.tradingPairs[tradingPair].quoteToken,
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
    const investmentTokenAddress = isBuyLow
      ? vaultParams.quoteToken
      : vaultParams.baseToken;
    const linkedTokenAddress = isBuyLow
      ? vaultParams.baseToken
      : vaultParams.quoteToken;
    const quantityBN = BigInt(vaultParams.quantity);

    const factory = new ethers.Contract(
      this.config.factory,
      FactoryABI,
      this.signer,
    );

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

    const tradingFee = calculateTradingFee(
      quantityBN,
      isBuyLow,
      tradingFeeRateBN,
      oraclePriceAtCreationBN,
    );

    // Approve spendings
    if (!useCollateralPool) {
      let linkedTokenAmount: bigint;
      let investmentTokenAmount =
        (quantityBN * yieldValueBN) / fixDecimalsBigNumber;

      if (isBuyLow) {
        linkedTokenAmount =
          (quantityBN * (fixDecimalsBigNumber + yieldValueBN)) / linkedPriceBN;
        investmentTokenAmount += tradingFee;
      } else {
        linkedTokenAmount =
          (quantityBN * (fixDecimalsBigNumber + yieldValueBN) * linkedPriceBN) /
          fixDecimalsBigNumber /
          fixDecimalsBigNumber;
        linkedTokenAmount += tradingFee;
      }

      const linkedTokenApproval = this._approveERC20(
        linkedTokenAddress,
        this.config.factory,
        linkedTokenAmount.toString(),
      );
      const investmentTokenApproval = this._approveERC20(
        investmentTokenAddress,
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
        console.log(`Processing CollateralPool Approval for: ${vaultAddress}:`);
        const collateralPool = new ethers.Contract(
          this.config.collateralPool,
          CollateralPoolABI,
          this.signer,
        );
        const tx = await collateralPool.approveVault(vaultAddress, true);
        const result: ContractTransactionReceipt = await tx.wait();
        if (result.status == 1) {
          console.log("CollateralPool approval succeeded!");
        } else {
          console.log("CollateralPool approval failed!");
        }
      }
    }
  }

  async cancelVault(vaultAddress: string) {
    const vault = new ethers.Contract(vaultAddress, VaultABI, this.signer);
    const isBuyLow = await vault.isBuyLow();
    const investmentTokenAddress = await vault.investmentToken();
    const linkedTokenAddress = await vault.linkedToken();
    const quantity = BigInt(await vault.quantity());
    const depositTotal = BigInt(await vault.depositTotal());
    const cancellationFeeRate = BigInt(await vault.cancellationFeeRate());

    if (cancellationFeeRate != BigInt(0)) {
      const remainingQuantity = quantity - depositTotal;
      let cancellationFee = remainingQuantity * cancellationFeeRate;
      if (isBuyLow) {
        cancellationFee = cancellationFee / fixDecimalsBigNumber;
      } else {
        const oraclePriceAtCreation = BigInt(
          await vault.oraclePriceAtCreation(),
        );
        cancellationFee =
          (cancellationFee * oraclePriceAtCreation) /
          fixDecimalsBigNumber /
          fixDecimalsBigNumber;
      }

      const quoteTokenDecimals = await this._getTokenDecimals(
        isBuyLow ? investmentTokenAddress : linkedTokenAddress,
      );
      console.log(
        `Cancellation fee: ${parseUnits(cancellationFee.toString(), quoteTokenDecimals).toString()}`,
      );
      await this._approveERC20(
        isBuyLow ? investmentTokenAddress : linkedTokenAddress,
        vaultAddress,
        cancellationFee.toString(),
      );
    } else {
      console.log("No cancellation fee for this vault");
    }

    try {
      const tx = await vault.lpCancel();
      const result = await tx.wait();

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
    const investmentTokenAddress = await vault.investmentToken();

    const investmentTokenDecimals = await this._getTokenDecimals(
      investmentTokenAddress,
    );
    const subscribeAmount = parseUnits(
      amount,
      investmentTokenDecimals,
    ).toString();
    await this._approveERC20(
      investmentTokenAddress,
      this.config.router,
      subscribeAmount,
    );

    // Get data from price feed
    const tradingPair = await this._getTradingPairOfVault(vaultAddress);
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
    const vault = new ethers.Contract(vaultAddress, VaultABI, this.signer);
    const owner = await vault.owner();
    const investmentTokenAddress = await vault.investmentToken();
    const linkedTokenAddress = await vault.linkedToken();

    console.log(`Withdrawing vault ${vaultAddress}...`);

    const expiry = await vault.expiry();
    if (Date.now() < Number(expiry) * 1000) {
      console.error(
        `Vault ${vaultAddress} is not yet available for withdrawal`,
      );
      return;
    }

    const account = await this.signer.getAddress();
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

    const tradingPair = await this._getTradingPairOfVault(vaultAddress);
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
        const state = await vault.state();
        if (state == 1) {
          // Check investment token balance in the vault, if it's 0, then LP has withdrawn the vault
          const investmentToken = await this._getToken(investmentTokenAddress);
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
          const linkedToken = await this._getToken(linkedTokenAddress);
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

  async withdrawAllVaults(checkOwner) {
    const factory = new ethers.Contract(
      this.config.factory,
      FactoryABI,
      this.signer,
    );
    const vaults = await factory.getDeployedVaults();

    for (const vaultAddress of vaults) {
      try {
        await this.withdrawVault(vaultAddress, checkOwner);
      } catch (error) {
        console.error(`Error withdrawing vault ${vaultAddress}`);
        console.error(error as EthersError);
      }
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
    const linkedOraclePrice = BigInt(await vault.linkedOraclePrice());
    const yieldValue = BigInt(await vault.yieldValue());
    const isBuyLow = await vault.isBuyLow();
    const investmentTokenAddress = await vault.investmentToken();
    const linkedTokenAddress = await vault.linkedToken();
    const quantity = BigInt(await vault.quantity());
    const state = await vault.state();
    const expiry = await vault.expiry();
    const depositTotal = BigInt(await vault.depositTotal());

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

    const investmentTokenDecimals = await this._getTokenDecimals(
      investmentTokenAddress,
    );
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
