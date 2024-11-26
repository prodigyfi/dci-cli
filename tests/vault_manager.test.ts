import { expect, test, describe, jest, afterEach } from "@jest/globals";
import { ethers, EventLog, NonceManager } from "ethers";
import { VaultManager } from "../src/vault_manager";
import { BlockchainConfig } from "../src/types";

import FactoryABI from "../abi/Factory.json";
import RouterAbi from "../abi/Router.json";
import VaultABI from "../abi/Vault.json";
import IERC20ABI from "../abi/IERC20.json";
import CollateralPoolABI from "../abi/CollateralPool.json";
import IPythABI from "@pythnetwork/pyth-sdk-solidity/abis/IPyth.json";

const mockConfig = {
  rpcNode: "https://not.a.real.url",
  account: "0x1563915e194D8CfBA1943570603F7606A3115508",
  jsonWallet: "mock_encrypted_json_path",
  passphrase: "mock_passphrase",
  factory: "0x3333333333333333333333333333333333333333",
  router: "0x4444444444444444444444444444444444444444",
  pythAggregator: "0x8888888888888888888888888888888888888888",
  pythPriceFeed: "0x9999999999999999999999999999999999999999",
  collateralPool: "0x1010101010101010101010101010101010101010",
  tradingPairs: {
    "WETH-USDC": {
      baseToken: "0x5555555555555555555555555555555555555555",
      quoteToken: "0x6666666666666666666666666666666666666666",
      priceFeed: {
        type: "Not A Real Oracle",
        address: "0x777777777777777777777777777777777777777",
        id: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        decimals: "8",
      },
    },
  },
};

const mockVaultAddress = "0x1234567890123456789012345678901234567890";

const mockBuyLowVaultOptions = {
  linkedPrice: "2500",
  quantity: "10",
  expiry: 1727769600,
  yieldPercentage: "3",
  tradingPair: "WETH-USDC",
  isBuyLow: true,
};

const mockSellHighVaultOptions = {
  linkedPrice: "4000",
  quantity: "5",
  expiry: 1727769600,
  yieldPercentage: "2",
  tradingPair: "WETH-USDC",
  isBuyLow: false,
};

const tradingPairConfig =
  mockConfig.tradingPairs[mockBuyLowVaultOptions.tradingPair];

const mockBasicSettings = {
  hermesApiBaseUrl: "https://hermes.pyth.network/",
};

const mockSigner = new NonceManager(
  new ethers.Wallet(
    "0x2222222222222222222222222222222222222222222222222222222222222222",
    new ethers.JsonRpcProvider(mockConfig.rpcNode),
  ),
);

jest
  .spyOn(VaultManager.prototype as any, "_initializeWallet")
  .mockReturnValue(mockSigner);

describe("VaultManager constructor", () => {
  test("create new instance", () => {
    const vaultManager = new VaultManager(mockConfig, mockBasicSettings);
    expect(vaultManager).toBeInstanceOf(VaultManager);
  });

  test("throws error when required config fields are missing", () => {
    const incompleteConfigs: Partial<BlockchainConfig>[] = [
      { ...mockConfig, rpcNode: undefined },
      { ...mockConfig, jsonWallet: undefined },
      { ...mockConfig, passphrase: undefined },
      { ...mockConfig, factory: undefined },
      { ...mockConfig, router: undefined },
    ];

    incompleteConfigs.forEach((config) => {
      expect(
        () => new VaultManager(config as BlockchainConfig, mockBasicSettings),
      ).toThrow();
    });
  });

  test("throws specific error messages for missing config fields", () => {
    const configTests = [
      { field: "rpcNode", expectedError: "rpcNode is not set" },
      { field: "jsonWallet", expectedError: "wallet path is not set" },
      { field: "passphrase", expectedError: "passphrase is not set" },
      { field: "factory", expectedError: "factory is not set" },
      { field: "router", expectedError: "router is not set" },
    ];

    configTests.forEach(({ field, expectedError }) => {
      const incompleteConfig = { ...mockConfig, [field]: undefined };
      expect(
        () =>
          new VaultManager(
            incompleteConfig as BlockchainConfig,
            mockBasicSettings,
          ),
      ).toThrow(expectedError);
    });
  });
});

const mockConsoleLog = jest.spyOn(console, "log").mockImplementation(() => {});
const mockConsoleError = jest
  .spyOn(console, "error")
  .mockImplementation(() => {});

const mockBase64Data =
  "eyJwcmljZSI6IDEyMy40NSwic3ltYm9sIjogIkJUQ1VTRCIsICJ0aW1lc3RhbXAiOiAxNjM0MDc1NjAwfQ==";
const mockBinaryData = Buffer.from(mockBase64Data, "base64");
const mockHexData = mockBinaryData.toString("hex");
const mockedParsedData = [
  {
    id: "9db37f4d5654aad3e37e2e14ffd8d53265fb3026d1d8f91146539eebaa2ef45f",
    price: {
      price: "134865270",
      conf: "296784",
      expo: -8,
      publish_time: 1731865158,
    },
    ema_price: {
      price: "134435181",
      conf: "314728",
      expo: -8,
      publish_time: 1731865158,
    },
    metadata: {
      slot: 178617999,
      proof_available_time: 1731865159,
      prev_publish_time: 1731865158,
    },
  },
];

describe("VaultManager createVault", () => {
  const vaultManager = new VaultManager(mockConfig, mockBasicSettings);
  const spyPythConnection = jest
    .spyOn(vaultManager.pythConnection, "getLatestPriceUpdates")
    .mockResolvedValue({
      binary: {
        encoding: "hex",
        data: [mockHexData],
      },
      parsed: mockedParsedData,
    });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const vaultCreationLog = Object.create(EventLog.prototype);
  Object.assign(vaultCreationLog, {
    address: "0xDe7c16c01CF3bABdA73a7516b2a5195A3B1F767e",
    blockHash:
      "0xc81b4c5ae1b5cd2e56be4c164df8c1aa9362e58a99fe0c4ef2fcfc3a533dc9c5",
    blockNumber: 7601043,
    data: "0x0000000000000000000000001bb4e6ae7719bb9aa3ddc7c4ea95fdbd4005bab40000000000000000000000000000000000000000000000000000000067515d8000000000000000000000000000000000000000000000000000000000b2d05e0000000000000000000000000000000000000000000000000000000045d964b800000000000000000000000000000000000000000000000000002386f26fc1000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000005f5e100000000000000000000000000000000000000000000000000000000006750b4c000000000000000000000000000000000000000000000000000f5232269808000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000db31302c",
    index: 320,
    topics: [
      "0x5abfe8ee47acb8d4a732ceac1ba1afc1eabbb14b7a8848e885f5ecddb5f5af33",
      "0x000000000000000000000000f4d594914ad2085795a746ec3713d652edbb6e10",
      "0x00000000000000000000000029ca87b2f744127606ada4564da8219be6498ca1",
      "0x000000000000000000000000137df25cabf220a180300604e57551ac1397959d",
    ],
    transactionHash:
      "0x0c80e91ae276b481c9204052d49570457f8e2aebe960277e40dff1dc08a79580",
    transactionIndex: 29,
  });
  const mockCreateVaultWait = jest
    .fn<() => Promise<object>>()
    .mockResolvedValue({
      status: 1,
      on: () => {},
      logs: [vaultCreationLog],
    });

  const mockApproveWait = jest
    .fn<() => Promise<object>>()
    .mockResolvedValue({ status: 1 });

  const mockApproveVaultWait = jest
    .fn<() => Promise<object>>()
    .mockResolvedValue({ status: 1 });

  const mockContract = {
    interface: {
      parseLog: jest.fn().mockReturnValue({
        name: "VaultCreated",
        args: { vaultAddress: "0x1bb4E6ae7719bB9Aa3dDC7c4eA95FDBD4005BAb4" },
      }),
    },
    events: {
      VaultCreated: jest.fn().mockReturnValue({
        abi: {
          inputs: FactoryABI.filter(
            (item) => item["type"] == "event" && item["name"] == "VaultCreated",
          )[0].inputs,
        },
      }),
    },
    decimals: jest.fn().mockReturnValue(18),
    approve: jest.fn().mockReturnValue({
      wait: mockApproveWait,
    }),
    balanceOf: jest.fn().mockReturnValue(900000000000000000000000000n),
    name: jest.fn().mockReturnValue("ETH"),
    createVault: jest.fn().mockReturnValue({
      wait: mockCreateVaultWait,
    }),
    getUpdateFee: jest.fn().mockReturnValue(1n),
    getPresetFeeParams: jest.fn().mockReturnValue({
      tradingFeeRate: 69000000000000000n,
    }),
    getTradingFeeTiers: jest.fn().mockReturnValue([
      { minimumVolume: 0n, feeRate: 69000000000000000n },
      { minimumVolume: 4200000000n, feeRate: 42000000000000000n },
      { minimumVolume: 42000000000n, feeRate: 24000000000000000n },
    ]),
    approveVault: jest.fn().mockReturnValue({
      wait: mockApproveVaultWait,
    }),
  };
  test("create new buy low vault successfully", async () => {
    const spyContract = jest
      .spyOn(ethers, "Contract")
      .mockReturnValue(mockContract as any);

    await vaultManager.createVault(mockBuyLowVaultOptions);

    expect(spyContract).toHaveBeenCalledTimes(6);
    expect(spyContract).toHaveBeenCalledWith(
      mockConfig.factory,
      FactoryABI,
      mockSigner,
    );
    expect(spyContract).toHaveBeenCalledWith(
      mockConfig.pythPriceFeed,
      IPythABI,
      mockSigner,
    );
    expect(spyContract).toHaveBeenCalledWith(
      tradingPairConfig.baseToken,
      IERC20ABI,
      mockSigner,
    );
    expect(spyContract).toHaveBeenCalledWith(
      tradingPairConfig.quoteToken,
      IERC20ABI,
      mockSigner,
    );

    expect(mockContract.createVault).toHaveBeenCalledWith(
      {
        baseToken: tradingPairConfig.baseToken,
        expiry: mockBuyLowVaultOptions.expiry,
        isBuyLow: mockBuyLowVaultOptions.isBuyLow,
        linkedOraclePrice: "250000000000",
        owner: mockConfig.account,
        quantity: "10000000000000000000",
        quoteToken: tradingPairConfig.quoteToken,
        yieldValue: "30000000000000000",
        useCollateralPool: false,
      },
      [mockBinaryData],
      { value: 1n, gasLimit: 3000000 },
    );

    expect(mockCreateVaultWait).toHaveBeenCalled();
  });

  test("create new sell high vault successfully", async () => {
    const spyContract = jest
      .spyOn(ethers, "Contract")
      .mockReturnValue(mockContract as any);

    await vaultManager.createVault(mockSellHighVaultOptions);

    expect(spyContract).toHaveBeenCalledTimes(6);
    expect(spyContract).toHaveBeenCalledWith(
      mockConfig.factory,
      FactoryABI,
      mockSigner,
    );
    expect(spyContract).toHaveBeenCalledWith(
      mockConfig.pythPriceFeed,
      IPythABI,
      mockSigner,
    );
    expect(spyContract).toHaveBeenCalledWith(
      tradingPairConfig.baseToken,
      IERC20ABI,
      mockSigner,
    );
    expect(spyContract).toHaveBeenCalledWith(
      tradingPairConfig.quoteToken,
      IERC20ABI,
      mockSigner,
    );

    expect(mockContract.createVault).toHaveBeenCalledWith(
      {
        baseToken: tradingPairConfig.baseToken,
        expiry: mockSellHighVaultOptions.expiry,
        isBuyLow: mockSellHighVaultOptions.isBuyLow,
        linkedOraclePrice: "400000000000",
        owner: mockConfig.account,
        quantity: "5000000000000000000",
        quoteToken: tradingPairConfig.quoteToken,
        yieldValue: "20000000000000000",
        useCollateralPool: false,
      },
      [mockBinaryData],
      { value: 1n, gasLimit: 3000000 },
    );

    expect(mockCreateVaultWait).toHaveBeenCalled();
  });

  test("create new collateralPool vault successfully", async () => {
    const spyContract = jest
      .spyOn(ethers, "Contract")
      .mockReturnValue(mockContract as any);

    await vaultManager.createVault({
      ...mockBuyLowVaultOptions,
      useCollateralPool: true,
    });

    expect(spyContract).toHaveBeenCalledTimes(5);
    expect(spyContract).toHaveBeenCalledWith(
      mockConfig.factory,
      FactoryABI,
      mockSigner,
    );
    expect(spyContract).toHaveBeenCalledWith(
      mockConfig.pythPriceFeed,
      IPythABI,
      mockSigner,
    );
    expect(spyContract).toHaveBeenCalledWith(
      mockConfig.collateralPool,
      CollateralPoolABI,
      mockSigner,
    );

    expect(mockContract.createVault).toHaveBeenCalledWith(
      {
        baseToken: tradingPairConfig.baseToken,
        expiry: mockBuyLowVaultOptions.expiry,
        isBuyLow: mockBuyLowVaultOptions.isBuyLow,
        linkedOraclePrice: "250000000000",
        owner: mockConfig.account,
        quantity: "10000000000000000000",
        quoteToken: tradingPairConfig.quoteToken,
        yieldValue: "30000000000000000",
        useCollateralPool: true,
      },
      [mockBinaryData],
      { value: 1n, gasLimit: 3000000 },
    );

    expect(mockCreateVaultWait).toHaveBeenCalled();
    expect(mockApproveVaultWait).toHaveBeenCalled();
  });

  test("should throw errors for invalid trading pair configurations", async () => {
    const invalidCreateVaultOptions = {
      linkedPrice: "2500",
      quantity: "1",
      expiry: 1727769600,
      yieldPercentage: "1",
    };

    // Test missing tradingPair
    await expect(
      vaultManager.createVault(invalidCreateVaultOptions as any),
    ).rejects.toThrow("tradingPair is not set");

    // Test invalid tradingPair
    await expect(
      vaultManager.createVault({
        ...invalidCreateVaultOptions,
        tradingPair: "INVALID-PAIR",
      }),
    ).rejects.toThrow("tradingPair is not valid");

    // Prepare a mock config with missing properties
    const mockInvalidConfig = JSON.parse(JSON.stringify(mockConfig));
    mockInvalidConfig.tradingPairs["MOCK-PAIR"] = {};

    const mockVaultManager = new VaultManager(
      mockInvalidConfig,
      mockBasicSettings,
    );

    // Test missing baseToken
    await expect(
      mockVaultManager.createVault({
        ...invalidCreateVaultOptions,
        tradingPair: "MOCK-PAIR",
      }),
    ).rejects.toThrow("baseToken is not set");

    // Test missing quoteToken
    mockInvalidConfig.tradingPairs["MOCK-PAIR"].baseToken =
      "0x1234567890123456789012345678901234567890";
    await expect(
      mockVaultManager.createVault({
        ...invalidCreateVaultOptions,
        tradingPair: "MOCK-PAIR",
      }),
    ).rejects.toThrow("quoteToken is not set");

    // Test missing decimals
    mockInvalidConfig.tradingPairs["MOCK-PAIR"].quoteToken =
      "0x0987654321098765432109876543210987654321";
    mockInvalidConfig.tradingPairs["MOCK-PAIR"].priceFeed = {};
    await expect(
      mockVaultManager.createVault({
        ...invalidCreateVaultOptions,
        tradingPair: "MOCK-PAIR",
      }),
    ).rejects.toThrow("decimals is not set");
  });
});

describe("VaultManager cancelVault", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const vaultManager = new VaultManager(mockConfig, mockBasicSettings);

  test("cancel vault successfully", async () => {
    const mockCancelWait = jest
      .fn<() => Promise<object>>()
      .mockResolvedValue({ status: 1 });

    const mockApproveWait = jest
      .fn<() => Promise<object>>()
      .mockResolvedValue({ status: 1 });

    const mockContract = {
      isBuyLow: jest.fn().mockReturnValue(mockBuyLowVaultOptions.isBuyLow),
      investmentToken: jest.fn().mockReturnValue(tradingPairConfig.baseToken),
      decimals: jest.fn().mockReturnValue(6),
      linkedToken: jest.fn().mockReturnValue(tradingPairConfig.quoteToken),
      quantity: jest.fn().mockReturnValue(mockBuyLowVaultOptions.quantity),
      depositTotal: jest.fn().mockReturnValue("100000000"),
      cancellationFeeRate: jest.fn().mockReturnValue("2"),
      oraclePriceAtCreation: jest
        .fn()
        .mockReturnValue(tradingPairConfig.priceFeed.address),
      lpCancel: jest.fn().mockReturnValue({
        wait: mockCancelWait,
      }),
      approve: jest.fn().mockReturnValue({
        wait: mockApproveWait,
      }),
      balanceOf: jest.fn().mockReturnValue(9000000000000000n),
      name: jest.fn().mockReturnValue("ETH"),
    };

    const spyContract = jest
      .spyOn(ethers, "Contract")
      .mockReturnValue(mockContract as any);

    await vaultManager.cancelVault(mockVaultAddress);

    expect(spyContract).toHaveBeenNthCalledWith(
      1,
      mockVaultAddress,
      VaultABI,
      mockSigner,
    );

    expect(spyContract).toHaveBeenNthCalledWith(
      2,
      mockBuyLowVaultOptions.isBuyLow
        ? tradingPairConfig.baseToken
        : tradingPairConfig.quoteToken,
      IERC20ABI,
      mockSigner,
    );

    expect(mockContract.approve).toHaveBeenCalledWith(mockVaultAddress, "0");

    expect(mockApproveWait).toHaveBeenCalledTimes(1);

    expect(mockCancelWait).toHaveBeenCalledTimes(1);
  });
});

describe("VaultManager subscribeVault", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const vaultManager = new VaultManager(mockConfig, mockBasicSettings);

  test("subscribe to vault successfully", async () => {
    const mockDepositWait = jest
      .fn<() => Promise<object>>()
      .mockResolvedValue({ status: 1 });

    const mockApproveWait = jest
      .fn<() => Promise<object>>()
      .mockResolvedValue({ status: 1 });

    const mockContract = {
      investmentToken: jest.fn().mockReturnValue(tradingPairConfig.quoteToken),
      linkedToken: jest.fn().mockReturnValue(tradingPairConfig.baseToken),
      decimals: jest.fn().mockReturnValue(6),
      deposit: jest.fn().mockReturnValue({
        wait: mockDepositWait,
      }),
      approve: jest.fn().mockReturnValue({
        wait: mockApproveWait,
      }),
      balanceOf: jest.fn().mockReturnValue(9000000000000000n),
      name: jest.fn().mockReturnValue("ETH"),
      isBuyLow: jest.fn().mockReturnValue(true),
      symbol: jest.fn().mockReturnValueOnce("USDC").mockReturnValueOnce("WETH"),
      getUpdateFee: jest.fn().mockReturnValue(1n),
    };

    const spyContract = jest
      .spyOn(ethers, "Contract")
      .mockReturnValue(mockContract as any);

    const spyPythConnection = jest
      .spyOn(vaultManager.pythConnection, "getLatestPriceUpdates")
      .mockResolvedValue({
        binary: {
          encoding: "hex",
          data: [mockHexData],
        },
        parsed: mockedParsedData,
      });

    await vaultManager.subscribeVault(mockVaultAddress, "1");

    expect(spyContract).toHaveBeenNthCalledWith(
      1,
      mockVaultAddress,
      VaultABI,
      mockSigner,
    );

    expect(spyContract).toHaveBeenNthCalledWith(
      2,
      tradingPairConfig.quoteToken,
      IERC20ABI,
      mockSigner,
    );

    expect(spyContract).toHaveBeenNthCalledWith(
      3,
      tradingPairConfig.quoteToken,
      IERC20ABI,
      mockSigner,
    );

    expect(spyContract).toHaveBeenNthCalledWith(
      4,
      mockVaultAddress,
      VaultABI,
      mockSigner,
    );

    expect(spyContract).toHaveBeenNthCalledWith(
      5,
      tradingPairConfig.quoteToken,
      IERC20ABI,
      mockSigner,
    );

    expect(spyContract).toHaveBeenNthCalledWith(
      6,
      tradingPairConfig.baseToken,
      IERC20ABI,
      mockSigner,
    );

    expect(spyContract).toHaveBeenNthCalledWith(
      7,
      mockConfig.pythPriceFeed,
      IPythABI,
      mockSigner,
    );

    expect(spyContract).toHaveBeenNthCalledWith(
      8,
      mockConfig.router,
      RouterAbi,
      mockSigner,
    );

    expect(mockContract.approve).toHaveBeenCalledWith(
      mockConfig.router,
      "1000000",
    );

    expect(mockContract.deposit).toHaveBeenCalledWith(
      mockVaultAddress,
      "1000000",
      [Buffer.from(mockHexData, "hex")],
      { value: 1n },
    );

    expect(mockApproveWait).toHaveBeenCalledTimes(1);
    expect(mockDepositWait).toHaveBeenCalledTimes(1);
  });
});

describe("VaultManager withdrawVault", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const mockWithdrawWait = jest
    .fn<() => Promise<object>>()
    .mockResolvedValue({ status: 1 });

  const mockGetUpdateFeeWait = jest
    .fn<() => Promise<Number>>()
    .mockResolvedValue(1);

  const mockWithdrawContract = {
    owner: jest.fn().mockReturnValue(mockConfig.account),
    isBuyLow: jest.fn().mockReturnValue(true),
    state: jest.fn().mockReturnValue(1),
    investmentToken: jest.fn().mockReturnValue(tradingPairConfig.quoteToken),
    linkedToken: jest.fn().mockReturnValue(tradingPairConfig.baseToken),
    expiry: jest.fn().mockReturnValue(mockBuyLowVaultOptions.expiry),
    balances: jest.fn().mockReturnValue("1"),
    balanceOf: jest.fn().mockReturnValue("1"),
    withdraw: jest.fn().mockReturnValue(mockWithdrawWait),
    lpWithdraw: jest.fn().mockReturnValue(mockWithdrawWait),
    getUpdateFee: jest.fn().mockReturnValue({ mockGetUpdateFeeWait }),
  };

  const vaultManager = new VaultManager(mockConfig, mockBasicSettings);

  test("LP withdraw with state 1 vault successfully", async () => {
    const mockContract = {
      ...mockWithdrawContract,
      state: jest.fn().mockReturnValue(1),
      symbol: jest.fn().mockReturnValueOnce("USDC").mockReturnValueOnce("WETH"),
    };

    const spyContract = jest
      .spyOn(ethers, "Contract")
      .mockReturnValue(mockContract as any);

    const spyPythConnection = jest
      .spyOn(vaultManager.pythConnection, "getPriceUpdatesAtTimestamp")
      .mockResolvedValue({
        binary: {
          encoding: "hex",
          data: [mockHexData],
        },
        parsed: mockedParsedData,
      });

    await vaultManager.withdrawVault(mockVaultAddress, true);

    expect(spyContract).toHaveBeenNthCalledWith(
      1,
      mockVaultAddress,
      VaultABI,
      mockSigner,
    );

    // _getTradingPairOfVault consumes three calls (vault, investmentToken, linkedToken)
    // and then pythPriceFeed consumes one call
    expect(spyContract).toHaveBeenNthCalledWith(
      6,
      tradingPairConfig.quoteToken,
      IERC20ABI,
      mockSigner,
    );

    expect(mockContract.balanceOf).toHaveBeenCalledWith(mockVaultAddress);

    expect(mockContract.lpWithdraw).toHaveBeenCalledTimes(1);
  });

  test("LP withdraw with state 2 vault successfully", async () => {
    const mockContract = {
      ...mockWithdrawContract,
      state: jest.fn().mockReturnValue(2),
      symbol: jest.fn().mockReturnValueOnce("USDC").mockReturnValueOnce("WETH"),
    };

    const spyContract = jest
      .spyOn(ethers, "Contract")
      .mockReturnValue(mockContract as any);

    const spyPythConnection = jest
      .spyOn(vaultManager.pythConnection, "getPriceUpdatesAtTimestamp")
      .mockResolvedValue({
        binary: {
          encoding: "hex",
          data: [mockHexData],
        },
        parsed: mockedParsedData,
      });

    await vaultManager.withdrawVault(mockVaultAddress, true);

    expect(spyContract).toHaveBeenNthCalledWith(
      1,
      mockVaultAddress,
      VaultABI,
      mockSigner,
    );

    // _getTradingPairOfVault consumes three calls (vault, investmentToken, linkedToken)
    // and then pythPriceFeed consumes one call
    expect(spyContract).toHaveBeenNthCalledWith(
      6,
      tradingPairConfig.baseToken,
      IERC20ABI,
      mockSigner,
    );

    expect(mockContract.balanceOf).toHaveBeenCalledWith(mockVaultAddress);

    expect(mockContract.lpWithdraw).toHaveBeenCalledTimes(1);
  });

  test("Subscriber withdraw vault successfully", async () => {
    const mockContract = {
      ...mockWithdrawContract,
      owner: jest
        .fn()
        .mockReturnValue("0x0000000000000000000000000000000000000000"),
      symbol: jest.fn().mockReturnValueOnce("USDC").mockReturnValueOnce("WETH"),
    };

    const spyContract = jest
      .spyOn(ethers, "Contract")
      .mockReturnValue(mockContract as any);

    const spyPythConnection = jest
      .spyOn(vaultManager.pythConnection, "getPriceUpdatesAtTimestamp")
      .mockResolvedValue({
        binary: {
          encoding: "hex",
          data: [mockHexData],
        },
        parsed: mockedParsedData,
      });

    await vaultManager.withdrawVault(mockVaultAddress, false);

    expect(spyContract).toHaveBeenNthCalledWith(
      1,
      mockVaultAddress,
      VaultABI,
      mockSigner,
    );

    expect(mockContract.balances).toHaveBeenCalledWith(
      await vaultManager.signer.getAddress(),
    );

    expect(mockContract.withdraw).toHaveBeenCalledTimes(1);
  });
});

describe("VaultManager withdrawAllVaults", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const vaultManager = new VaultManager(mockConfig, mockBasicSettings);

  test("withdraw each vault", async () => {
    const checkOwner = true;

    const mockVaults = [
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000002",
      "0x0000000000000000000000000000000000000003",
      "0x0000000000000000000000000000000000000004",
    ] as any;

    const mockContract = {
      getDeployedVaults: jest.fn().mockReturnValue(mockVaults),
    };

    const spyContract = jest
      .spyOn(ethers, "Contract")
      .mockReturnValue(mockContract as any);

    const spyWithdrawVault = jest
      .spyOn(vaultManager, "withdrawVault")
      .mockResolvedValue();

    await vaultManager.withdrawAllVaults(checkOwner);

    expect(spyContract).toHaveBeenNthCalledWith(
      1,
      mockConfig.factory,
      FactoryABI,
      mockSigner,
    );

    for (const vaultAddress of mockVaults) {
      expect(spyWithdrawVault).toHaveBeenCalledWith(vaultAddress, checkOwner);
    }

    expect(spyWithdrawVault).toHaveBeenCalledTimes(mockVaults.length);
  });
});

describe("VaultManager listAllVaults", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const vaultManager = new VaultManager(mockConfig, mockBasicSettings);

  test("list all vaults that created by the LP", async () => {
    const lpAddress = "0x9999999999999999999999999999999999999999";
    const otherLpAddress = "0x7777777777777777777777777777777777777777";

    const mockVaults = [
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000002",
      "0x0000000000000000000000000000000000000003",
      "0x0000000000000000000000000000000000000004",
    ];

    const mockContract = {
      getDeployedVaults: jest.fn().mockReturnValue(mockVaults),
      owner: jest
        .fn()
        .mockReturnValueOnce(lpAddress)
        .mockReturnValueOnce(lpAddress)
        .mockReturnValue(otherLpAddress),
    };

    const spyContract = jest
      .spyOn(ethers, "Contract")
      .mockReturnValue(mockContract as any);

    await vaultManager.listAllVaults(lpAddress);

    expect(spyContract).toHaveBeenNthCalledWith(
      1,
      mockConfig.factory,
      FactoryABI,
      mockSigner,
    );

    expect(mockConsoleLog).toHaveBeenCalledWith(mockVaults.slice(0, 2));
  });
});

describe("VaultManager showVault", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const vaultManager = new VaultManager(mockConfig, mockBasicSettings);

  test("list parameters of a vault", async () => {
    const tradingPairConfig =
      mockConfig.tradingPairs[mockBuyLowVaultOptions.tradingPair];

    const mockVaultAddress = "0x0000000000000000000000000000000000000001";
    const mockTransactionHash =
      "0x20011e4f47e797f8854a902719fd5ccb477dae8e2dd6d60fd196cfcc07f3fc56";
    const mockBlockNumber = 17259837n;
    const mockCreationTimestamp = 1730287962n;

    const mockContract = {
      linkedOraclePrice: jest.fn().mockReturnValue(290000000000n),
      yieldValue: jest.fn().mockReturnValue(10000000000000000n),
      isBuyLow: jest.fn().mockReturnValue(true),
      investmentToken: jest.fn().mockReturnValue(tradingPairConfig.quoteToken),
      linkedToken: jest.fn().mockReturnValue(tradingPairConfig.baseToken),
      quantity: jest.fn().mockReturnValue(2000000n),
      state: jest.fn().mockReturnValue(0n),
      expiry: jest.fn().mockReturnValue(1730344973n),
      depositTotal: jest.fn().mockReturnValue(1000000n),
      decimals: jest.fn().mockReturnValue(6),
    };

    const spyContract = jest
      .spyOn(ethers, "Contract")
      .mockReturnValue(mockContract as any);

    const spyGetPastLogs = jest
      .spyOn(vaultManager.provider, "getLogs")
      .mockResolvedValue([
        {
          transactionHash: mockTransactionHash,
        },
      ] as any);

    const spyGetTransaction = jest
      .spyOn(vaultManager.provider, "getTransaction")
      .mockResolvedValue({
        blockNumber: mockBlockNumber,
      } as any);

    const spyGetBlock = jest
      .spyOn(vaultManager.provider, "getBlock")
      .mockResolvedValue({
        timestamp: mockCreationTimestamp,
      } as any);

    await vaultManager.showVault(mockVaultAddress);

    expect(spyContract).toHaveBeenNthCalledWith(
      1,
      mockVaultAddress,
      VaultABI,
      expect.anything(),
    );

    expect(spyGetPastLogs).toHaveBeenCalledWith({
      address: mockVaultAddress,
      fromBlock: 0,
      toBlock: "latest",
    });
    expect(spyGetTransaction).toHaveBeenCalledWith(mockTransactionHash);
    expect(spyGetBlock).toHaveBeenCalledWith(mockBlockNumber);

    expect(mockConsoleLog).toHaveBeenNthCalledWith(
      1,
      `Base token address: ${tradingPairConfig.baseToken}`,
    );
    expect(mockConsoleLog).toHaveBeenNthCalledWith(
      2,
      `Quote token address: ${tradingPairConfig.quoteToken}`,
    );
    expect(mockConsoleLog).toHaveBeenNthCalledWith(3, `Linked Price: 2900.0`);
    expect(mockConsoleLog).toHaveBeenNthCalledWith(4, `Yield: 1.0%`);
    expect(mockConsoleLog).toHaveBeenNthCalledWith(
      5,
      expect.stringMatching(/Creation Date:/),
    );
    expect(mockConsoleLog).toHaveBeenNthCalledWith(
      6,
      expect.stringMatching(/Expiry:/),
    );

    expect(mockConsoleLog).toHaveBeenNthCalledWith(7, `Direction: Buy Low`);
    expect(mockConsoleLog).toHaveBeenNthCalledWith(8, `Quantity: 2.0`);
    expect(mockConsoleLog).toHaveBeenNthCalledWith(
      9,
      `Remaining Quantity: 1.0`,
    );
    expect(mockConsoleLog).toHaveBeenNthCalledWith(10, `State: 0`);
  });
});
