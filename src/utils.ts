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

export function calculateListingFee(
  amount: bigint,
  isBuyLow: boolean,
  listingFeeRate: bigint,
  oraclePriceAtCreation: bigint,
): bigint {
  if (isBuyLow) {
    return (amount * listingFeeRate) / fixDecimalsBigNumber;
  }
  return (
    (amount * listingFeeRate * oraclePriceAtCreation * 101n) /
    100n /
    fixDecimalsBigNumber /
    fixDecimalsBigNumber
  );
}
