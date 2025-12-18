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
  useNativeToken: boolean;
  vaultSeriesVersion: number;
  signer: string;
};

export function calculateTradingFee(
  amount: bigint,
  yieldValue: bigint,
  isBuyLow: boolean,
  tradingFeeRate: bigint,
  oraclePriceAtCreation: bigint,
): bigint {
  if (isBuyLow) {
    return (
      (amount * yieldValue * tradingFeeRate) /
      fixDecimalsBigNumber /
      fixDecimalsBigNumber
    );
  }
  // Approve 1% more for buffering to prevent vault creation failed due to oracle price change
  return (
    (amount * yieldValue * tradingFeeRate * oraclePriceAtCreation * 101n) /
    100n /
    fixDecimalsBigNumber /
    fixDecimalsBigNumber /
    fixDecimalsBigNumber
  );
}

export function calculateTokenAmounts(
  amount: bigint,
  yieldValue: bigint,
  isBuyLow: boolean,
  tradingFeeRate: bigint,
  oraclePriceAtCreation: bigint,
  linkedPrice: bigint,
): { linkedTokenAmount: bigint; investmentTokenAmount: bigint } {
  const fees = calculateTradingFee(
    amount,
    yieldValue,
    isBuyLow,
    tradingFeeRate,
    oraclePriceAtCreation,
  );

  let linkedTokenAmount: bigint;
  let investmentTokenAmount: bigint =
    (amount * yieldValue) / fixDecimalsBigNumber;

  if (isBuyLow) {
    linkedTokenAmount =
      (amount * (fixDecimalsBigNumber + yieldValue)) / linkedPrice;
    investmentTokenAmount = investmentTokenAmount + fees;
  } else {
    linkedTokenAmount =
      (amount * (fixDecimalsBigNumber + yieldValue) * linkedPrice) /
      fixDecimalsBigNumber /
      fixDecimalsBigNumber;
    linkedTokenAmount = linkedTokenAmount + fees;
  }
  return { linkedTokenAmount, investmentTokenAmount };
}
