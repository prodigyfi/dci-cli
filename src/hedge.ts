import { buyDeribitOption } from "./deribit";

const hedgeMap = {
  deribit: buyDeribitOption,
};

export function validHedges() {
  return Object.keys(hedgeMap);
}

export function validateHedge(hedge: string) {
  return !!hedgeMap[hedge.toLowerCase()];
}

export async function hedgeWith(createVaultOptions) {
  const isBuyLow = !!createVaultOptions.isBuyLow;
  const tradingPair = createVaultOptions.tradingPair;

  const baseToken = tradingPair.split("-")[0];
  const linkedPrice = createVaultOptions.linkedPrice;
  const exactExpiration = createVaultOptions.exactExpiration;
  const quantity = createVaultOptions.quantity;
  const optionType = isBuyLow ? "call" : "put";

  if (!validateHedge(createVaultOptions.hedge)) {
    console.error("Invalid hedge option");
    return;
  }

  await hedgeMap[createVaultOptions.hedge.toLowerCase()](
    baseToken,
    linkedPrice,
    exactExpiration,
    quantity,
    optionType,
  );
}
