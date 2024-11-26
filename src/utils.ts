export const fixDecimals = 18;
export const fixDecimalsBigNumber = BigInt(10) ** BigInt(fixDecimals);
export const zeroBigNumber = BigInt(0);

export type CreateVaultParamsStruct = {
  owner: string;
  baseToken: string;
  quoteToken: string;
  expiry: number;
  linkedOraclePrice: string;
  yieldValue: string;
  isBuyLow: boolean;
  quantity: string;
};

export function calculateTradingFee(
  amount: bigint,
  isBuyLow: boolean,
  tradingFeeRate: bigint,
  oraclePriceAtCreation: bigint,
): bigint {
  if (isBuyLow) {
    return (amount * tradingFeeRate) / fixDecimalsBigNumber;
  }
  return (
    (amount * tradingFeeRate * oraclePriceAtCreation * 101n) /
    100n /
    fixDecimalsBigNumber /
    fixDecimalsBigNumber
  );
}
