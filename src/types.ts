export type TradingPair = {
  baseToken: string;
  quoteToken: string;
  priceFeed: {
    type: string;
    address?: string;
    id?: string;
    decimals: string;
  };
};

export type TradingPairs = { [key: string]: TradingPair };

export type BlockchainConfig = {
  rpcNode: string;
  account: string;
  jsonWallet: string;
  passphrase: string;
  factory: string;
  router: string;
  pythAggregator: string;
  pythPriceFeed: string;
  collateralPool: string;
  tradingPairs: TradingPairs;
};

export type BasicSettings = {
  hermesApiBaseUrl: string;
};
