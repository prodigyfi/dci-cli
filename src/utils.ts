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
  useCollateralPool: boolean;
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
  // Approve 1% more for buffering to prevent vault creation failed due to oracle price change
  return (
    (amount * tradingFeeRate * oraclePriceAtCreation * 101n) /
    100n /
    fixDecimalsBigNumber /
    fixDecimalsBigNumber
  );
}
