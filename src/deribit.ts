import config from "../config.json";
import { DeribitAPI } from "./deribit_api";

const tokenMap = {
  WETH: "ETH",
  WBTC: "BTC",
};

const validTokens = ["BTC", "ETH", "USDC", "USDT", "EURR"];

export async function buyDeribitOption(
  token: string,
  price: number,
  expire: number,
  quantity: number,
  optionType: string,
) {
  if (!Object.keys(config).includes("deribit")) {
    console.error("[Deribit] config not found");
    return;
  }

  const deribit = new DeribitAPI(
    config["deribit"].clientID,
    config["deribit"].clientSecret,
    config["deribit"].useTestAPI,
  );

  const targetToken = tokenMap[token] || token;

  if (!validTokens.includes(targetToken)) {
    console.log(`[Deribit] ${targetToken} is not a valid token`);
    return;
  }

  let instruments;

  try {
    instruments = await deribit.getInstruments(targetToken, "option");
  } catch (error) {
    console.error("[Deribit] Error fetching instruments:", error.message);
    return;
  }

  instruments = instruments.filter((ins) => ins.option_type == optionType);

  if (instruments.length == 0) {
    console.log("[Deribit] No valid instrument found");
    return;
  }

  const targetInstrument = instruments.reduce((acc, cur) => {
    const curPriceVar = Math.abs(cur.strike - price);
    const accPriceVar = Math.abs(acc.strike - price);
    // Same price
    if (curPriceVar == accPriceVar) {
      const curExpireVar = Math.abs(cur.expiration_timestamp - expire);
      const accExpireVar = Math.abs(acc.expiration_timestamp - expire);
      // Compare expiration timestamp
      return curExpireVar < accExpireVar ? cur : acc;
    }
    return curPriceVar < accPriceVar ? cur : acc;
  });

  try {
    const buyResponse = await deribit.buy(
      targetInstrument.instrument_name,
      quantity,
    );
    console.log("[Deribit] Buy Response:", buyResponse);
  } catch (error) {
    console.error("[Deribit] Error making buy order:", error.message);
  }
}
