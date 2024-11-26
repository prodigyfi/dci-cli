import {
  expect,
  test,
  describe,
  jest,
  afterEach,
  beforeEach,
} from "@jest/globals";
import { ethers } from "ethers";
import { VaultManager } from "../src/vault_manager";
import { BlockchainConfig } from "../src/types";

import factoryABI from "../abi/factory.json";
import routerAbi from "../abi/router.json";
import vaultABI from "../abi/vault.json";
import IERC20ABI from "../abi/IERC20.json";
import IPythABI from "@pythnetwork/pyth-sdk-solidity/abis/IPyth.json";

const mockConfig = {
  rpcNode: "https://not.a.real.url",
  account: "0x1563915e194D8CfBA1943570603F7606A3115508",
  privateKey:
    "0x2222222222222222222222222222222222222222222222222222222222222222",
  factory: "0x3333333333333333333333333333333333333333",
  router: "0x4444444444444444444444444444444444444444",
  pythAggregator: "0x8888888888888888888888888888888888888888",
  pythPriceFeed: "0x9999999999999999999999999999999999999999",
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
  listingFeeRate: "0.02",
};

describe("VaultManager constructor", () => {
  test("create new instance", () => {
    const vaultManager = new VaultManager(mockConfig, mockBasicSettings);
    expect(vaultManager).toBeInstanceOf(VaultManager);
  });

  test("throws error when required config fields are missing", () => {
    const incompleteConfigs: Partial<BlockchainConfig>[] = [
      { ...mockConfig, rpcNode: undefined },
      { ...mockConfig, privateKey: undefined },
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
      { field: "privateKey", expectedError: "privateKey is not set" },
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

describe("VaultManager createVault", () => {
  const mockCreateVaultWait = jest
    .fn<() => Promise<object>>()
    .mockResolvedValue({
      status: 1,
      on: () => {},
      logs: [
        // NOTE: there are total 9 events, plus the 'self' entry, there
        // should be 10 entries.
        // The first (1 + 8) entries are irrelevant.
        {},
        {},
        {},
        {},
        {},
        {},
        {},
        {},
        {},
        {
          address: "0x2ec8deb018b85274feb514d15ed7566ba50dabe6",
          topics: [
            "0x60ce7fc00fa57735b9856f4fea25995be89bf2b7e95516b5d99fe1c71a5e4ca8",
            "0x000000000000000000000000f4d594914ad2085795a746ec3713d652edbb6e10",
            "0x000000000000000000000000a4bbc0d6fa475d9dbe0b6f04333ecc92339ceb2f",
            "0x0000000000000000000000008dcf7eeb4442059601bbfd0a65fff8d6e7b538d9",
          ],
          data: "0x000000000000000000000000866d977f60bbcfb68d850b98ec5bf689b0ce369a00000000000000000000000000000000000000000000000000000000670aeba8000000000000000000000000000000000000000000000000000000009502f9000000000000000000000000000000000000000000000000000000003a35294400000000000000000000000000000000000000000000000000002386f26fc1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000000000000000670a42e800000000000000000000000000000000000000000000000000000000670af9b800000000000000000000000000000000000000000000000000470de4df8200000000000000000000000000000000000000000000000000000008e1bc9bf04000000000000000000000000000000000000000000000000000000000008f48f884",
          blockNumber: 16428519n,
          transactionHash:
            "0xf5cde2fe3154b229014565504ea63c1e6b583580d2eea613f8590efe203586b8",
          transactionIndex: 1n,
          blockHash:
            "0xf6f8e91e9852affc94f1e1869032f3ac55e5aa9584b8c920c6bca87178294787",
          logIndex: 9n,
          removed: false,
        },
      ],
    });
  const mockApproveWait = jest
    .fn<() => Promise<object>>()
    .mockResolvedValue({ status: 1 });

  const mockGetUpdateFeeWait = jest
    .fn<() => Promise<Number>>()
    .mockResolvedValue(1);
  const mockContract = {
    events: {
      VaultCreated: jest.fn().mockReturnValue({
        abi: {
          inputs: factoryABI.filter(
            (item) => item["type"] == "event" && item["name"] == "VaultCreated",
          )[0].inputs,
        },
      }),
    },
    decimals: jest.fn().mockReturnValue(18),
    approve: jest.fn().mockReturnValue({
      wait: mockApproveWait,
    }),
    createVault: jest.fn().mockReturnValue({
      wait: mockCreateVaultWait,
    }),
    getUpdateFee: jest.fn().mockReturnValue({
      wait: mockGetUpdateFeeWait,
    }),
  };
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

  let vaultManager: VaultManager;
  beforeEach(() => {
    vaultManager = new VaultManager(mockConfig, mockBasicSettings);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.skip("create new buy low vault successfully", async () => {
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
    await vaultManager.createVault(mockBuyLowVaultOptions);

    expect(spyContract).toHaveBeenCalledTimes(6);
    expect(spyContract).toHaveBeenCalledWith(factoryABI, mockConfig.factory);
    expect(spyContract).toHaveBeenCalledWith(
      IPythABI,
      mockConfig.pythPriceFeed,
    );
    expect(spyContract).toHaveBeenCalledWith(
      IERC20ABI,
      tradingPairConfig.baseToken,
    );
    expect(spyContract).toHaveBeenCalledWith(
      IERC20ABI,
      tradingPairConfig.quoteToken,
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
      },
      [mockBinaryData],
    );

    expect(mockCreateVaultWait).toHaveBeenCalledWith({
      from: await vaultManager.signer.getAddress(),
      value: 1,
    });
  });

  test.skip("create new sell high vault successfully", async () => {
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
    await vaultManager.createVault(mockSellHighVaultOptions);

    expect(spyContract).toHaveBeenCalledTimes(6);
    expect(spyContract).toHaveBeenCalledWith(factoryABI, mockConfig.factory);
    expect(spyContract).toHaveBeenCalledWith(
      IPythABI,
      mockConfig.pythPriceFeed,
    );
    expect(spyContract).toHaveBeenCalledWith(
      IERC20ABI,
      tradingPairConfig.baseToken,
    );
    expect(spyContract).toHaveBeenCalledWith(
      IERC20ABI,
      tradingPairConfig.quoteToken,
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
      },
      [mockBinaryData],
    );

    expect(mockCreateVaultWait).toHaveBeenCalledWith({
      from: await vaultManager.signer.getAddress(),
      value: 1,
    });
  });

  test("should throw errors for invalid trading pair configurations", async () => {
    const vaultManager = new VaultManager(mockConfig, mockBasicSettings);

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
  test.skip("cancel vault successfully", async () => {
    const vaultManager = new VaultManager(mockConfig, mockBasicSettings);

    const mockCancelWait = jest
      .fn<() => Promise<object>>()
      .mockResolvedValue({ status: 1 });

    const mockApproveWait = jest
      .fn<() => Promise<object>>()
      .mockResolvedValue({ status: 1 });

    const mockContract = {
      isBuyLow: jest.fn().mockReturnValue(mockBuyLowVaultOptions.isBuyLow),
      investmentToken: jest.fn().mockReturnValue(tradingPairConfig.baseToken),
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
    };

    const spyContract = jest
      .spyOn(ethers, "Contract")
      .mockReturnValue(mockContract as any);

    await vaultManager.cancelVault(mockVaultAddress);

    expect(spyContract).toHaveBeenNthCalledWith(1, mockVaultAddress, vaultABI, {
      address: mockConfig.account,
      provider: {},
    });

    expect(spyContract).toHaveBeenNthCalledWith(
      2,
      mockBuyLowVaultOptions.isBuyLow
        ? tradingPairConfig.baseToken
        : tradingPairConfig.quoteToken,
      IERC20ABI,
      { address: mockConfig.account, provider: {} },
    );

    expect(mockContract.approve).toHaveBeenCalledWith(mockVaultAddress, "0");

    expect(mockApproveWait).toHaveBeenCalledTimes(1);

    expect(mockCancelWait).toHaveBeenCalledTimes(1);
  });
});

describe("VaultManager subscribeVault", () => {
  test.skip("subscribe to vault successfully", async () => {
    const vaultManager = new VaultManager(mockConfig, mockBasicSettings);

    const mockDepositWait = jest
      .fn<() => Promise<object>>()
      .mockResolvedValue({ status: 1 });

    const mockApproveWait = jest
      .fn<() => Promise<object>>()
      .mockResolvedValue({ status: 1 });

    const mockGetUpdateFeeWait = jest
      .fn<() => Promise<Number>>()
      .mockResolvedValue(1);

    const mockContract = {
      investmentToken: jest.fn().mockReturnValue(tradingPairConfig.baseToken),
      linkedToken: jest.fn().mockReturnValue(tradingPairConfig.quoteToken),
      decimals: jest.fn().mockReturnValue(8),
      deposit: jest.fn().mockReturnValue(mockDepositWait),
      approve: jest.fn().mockReturnValue(mockApproveWait),
      isBuyLow: jest.fn().mockReturnValue(true),
      symbol: jest.fn().mockReturnValue("WETH"),
      getUpdateFee: jest.fn().mockReturnValue({ mockGetUpdateFeeWait }),
    };
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

    expect(spyContract).toHaveBeenNthCalledWith(1, mockVaultAddress, vaultABI, {
      address: mockConfig.account,
      provider: {},
    });

    expect(spyContract).toHaveBeenNthCalledWith(
      2,
      IERC20ABI,
      tradingPairConfig.baseToken,
    );

    expect(spyContract).toHaveBeenNthCalledWith(
      3,
      routerAbi,
      mockConfig.router,
    );

    expect(mockContract.approve).toHaveBeenCalledWith(
      mockConfig.router,
      "100000000",
    );

    expect(mockContract.deposit).toHaveBeenCalledWith(
      mockVaultAddress,
      "100000000",
      [],
      { value: 0n },
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

  test("LP withdraw with state 1 vault successfully", async () => {
    const vaultManager = new VaultManager(mockConfig, mockBasicSettings);

    const mockContract = {
      ...mockWithdrawContract,
      state: jest.fn().mockReturnValue(1),
      symbol: jest.fn().mockReturnValueOnce("USDC").mockReturnValueOnce("WETH"),
    };

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

    expect(spyContract).toHaveBeenNthCalledWith(1, mockVaultAddress, vaultABI, {
      address: mockConfig.account,
      provider: {},
    });

    // _getTradingPairOfVault consumes three calls (vault, investmentToken, linkedToken)
    // and then pythPriceFeed consumes one call
    expect(spyContract).toHaveBeenNthCalledWith(
      6,
      tradingPairConfig.quoteToken,
      IERC20ABI,
      {
        address: mockConfig.account,
        provider: {},
      },
    );

    expect(mockContract.balanceOf).toHaveBeenCalledWith(mockVaultAddress);

    expect(mockContract.lpWithdraw).toHaveBeenCalledTimes(1);
  });

  test("LP withdraw with state 2 vault successfully", async () => {
    const vaultManager = new VaultManager(mockConfig, mockBasicSettings);

    const mockContract = {
      ...mockWithdrawContract,
      state: jest.fn().mockReturnValue(2),
      symbol: jest.fn().mockReturnValueOnce("USDC").mockReturnValueOnce("WETH"),
    };

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

    expect(spyContract).toHaveBeenNthCalledWith(1, mockVaultAddress, vaultABI, {
      address: mockConfig.account,
      provider: {},
    });

    // _getTradingPairOfVault consumes three calls (vault, investmentToken, linkedToken)
    // and then pythPriceFeed consumes one call
    expect(spyContract).toHaveBeenNthCalledWith(
      6,
      tradingPairConfig.baseToken,
      IERC20ABI,
      {
        address: mockConfig.account,
        provider: {},
      },
    );

    expect(mockContract.balanceOf).toHaveBeenCalledWith(mockVaultAddress);

    expect(mockContract.lpWithdraw).toHaveBeenCalledTimes(1);
  });

  test("Subscriber withdraw vault successfully", async () => {
    const vaultManager = new VaultManager(mockConfig, mockBasicSettings);

    const mockContract = {
      ...mockWithdrawContract,
      owner: jest
        .fn()
        .mockReturnValue("0x0000000000000000000000000000000000000000"),
      symbol: jest.fn().mockReturnValueOnce("USDC").mockReturnValueOnce("WETH"),
    };

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

    expect(spyContract).toHaveBeenNthCalledWith(1, mockVaultAddress, vaultABI, {
      address: mockConfig.account,
      provider: {},
    });

    expect(mockContract.balances).toHaveBeenCalledWith(
      await vaultManager.signer.getAddress(),
    );

    expect(mockContract.withdraw).toHaveBeenCalledTimes(1);
  });
});

describe("VaultManager withdrawAllVaults", () => {
  test("withdraw each vault", async () => {
    const checkOwner = true;

    const vaultManager = new VaultManager(mockConfig, mockBasicSettings);

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
      factoryABI,
      {
        address: mockConfig.account,
        provider: {},
      },
    );

    for (const vaultAddress of mockVaults) {
      expect(spyWithdrawVault).toHaveBeenCalledWith(vaultAddress, checkOwner);
    }

    expect(spyWithdrawVault).toHaveBeenCalledTimes(mockVaults.length);
  });
});

describe("VaultManager listAllVaults", () => {
  test("list all vaults that created by the LP", async () => {
    const lpAddress = "0x9999999999999999999999999999999999999999";
    const otherLpAddress = "0x7777777777777777777777777777777777777777";

    const vaultManager = new VaultManager(mockConfig, mockBasicSettings);

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

    const mockConsoleLog = jest
      .spyOn(console, "log")
      .mockImplementation(() => {});

    await vaultManager.listAllVaults(lpAddress);

    expect(spyContract).toHaveBeenNthCalledWith(
      1,
      mockConfig.factory,
      factoryABI,
      { address: mockConfig.account, provider: {} },
    );

    expect(mockConsoleLog).toHaveBeenCalledWith(mockVaults.slice(0, 2));
  });
});

describe("VaultManager showVault", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("list parameters of a vault", async () => {
    const vaultManager = new VaultManager(mockConfig, mockBasicSettings);

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

    const mockConsoleLog = jest.spyOn(console, "log");

    await vaultManager.showVault(mockVaultAddress);

    expect(spyContract).toHaveBeenNthCalledWith(3, mockVaultAddress, vaultABI, {
      address: mockConfig.account,
      provider: {},
    });

    // FIX ME: Not sure why the mock loads other vaults
    // expect(spyContract).toHaveBeenNthCalledWith(
    //   4,
    //   tradingPairConfig.quoteToken,
    //   IERC20ABI,
    //   {
    //     address: mockConfig.account,
    //     provider: {},
    //   },
    // );

    expect(spyGetPastLogs).toHaveBeenCalledWith({
      address: mockVaultAddress,
      fromBlock: 0,
      toBlock: "latest",
    });
    expect(spyGetTransaction).toHaveBeenCalledWith(mockTransactionHash);
    expect(spyGetBlock).toHaveBeenCalledWith(mockBlockNumber);

    expect(mockConsoleLog).toHaveBeenNthCalledWith(
      3,
      `Base token address: ${tradingPairConfig.baseToken}`,
    );
    expect(mockConsoleLog).toHaveBeenNthCalledWith(
      4,
      `Quote token address: ${tradingPairConfig.quoteToken}`,
    );
    expect(mockConsoleLog).toHaveBeenNthCalledWith(5, `Linked Price: 2900.0`);
    expect(mockConsoleLog).toHaveBeenNthCalledWith(6, `Yield: 1.0%`);
    expect(mockConsoleLog).toHaveBeenNthCalledWith(
      7,
      expect.stringMatching(/Creation Date:/),
    );
    expect(mockConsoleLog).toHaveBeenNthCalledWith(
      8,
      expect.stringMatching(/Expiry:/),
    );

    expect(mockConsoleLog).toHaveBeenNthCalledWith(9, `Direction: Buy Low`);
    expect(mockConsoleLog).toHaveBeenNthCalledWith(10, `Quantity: 2.0`);
    expect(mockConsoleLog).toHaveBeenNthCalledWith(
      11,
      `Remaining Quantity: 1.0`,
    );
    expect(mockConsoleLog).toHaveBeenNthCalledWith(12, `State: 0`);
  });
});
