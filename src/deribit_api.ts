interface Instrument {
  instrument_name: string;
  is_active: boolean;
  kind: string;
  base_currency: string;
  quote_currency: string;
  settlement_currency: string;
  strike: number;
  expiration_timestamp: number;
  option_type: string;
}

interface BuyResponse {
  order: {
    order_id: string;
    amount: number;
    price: number;
    instrument_name: string;
  };
}

interface ApiResponse<T> {
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

export class DeribitAPI {
  private clientID: string;
  private clientSecret: string;
  private baseUrl: string;

  constructor(
    clientID: string,
    clientSecret: string,
    useTestAPI: boolean = false,
  ) {
    this.clientID = clientID;
    this.clientSecret = clientSecret;
    // Choose the base URL based on whether the user wants to use the test API
    this.baseUrl = useTestAPI
      ? "https://test.deribit.com/api/v2" // Test API endpoint
      : "https://www.deribit.com/api/v2"; // Live API endpoint
  }

  private async publicCall<T>(
    endpoint: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + endpoint);
    Object.keys(params).forEach((key) =>
      url.searchParams.append(key, params[key]),
    );

    const response = await fetch(url.toString());
    const data: ApiResponse<T> = await response.json();

    if (data.error) {
      throw new Error(`Error ${data.error.code}: ${data.error.message}`);
    }
    return data.result as T;
  }

  private async privateCall<T>(
    endpoint: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + endpoint);
    Object.keys(params).forEach((key) =>
      url.searchParams.append(key, params[key]),
    );

    const credential = Buffer.from(
      this.clientID + ":" + this.clientSecret,
    ).toString("base64");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${credential}`,
      },
    });

    const data: ApiResponse<T> = await response.json();

    if (data.error) {
      throw new Error(`Error ${data.error.code}: ${data.error.message}`);
    }
    return data.result as T;
  }

  // Public API: Get all instruments
  async getInstruments(
    currency: string = "BTC",
    kind: string = "option",
  ): Promise<Instrument[]> {
    return this.publicCall<Instrument[]>("/public/get_instruments", {
      currency,
      kind,
    });
  }

  // Private API: Buy a specified amount of an instrument
  async buy(instrument_name: string, amount: number): Promise<BuyResponse> {
    return this.privateCall<BuyResponse>("/private/buy", {
      instrument_name,
      amount: amount.toString(),
      type: "market",
    });
  }
}

// Usage Example:

// (async () => {
//   const deribit = new DeribitAPI("CLIENT_ID", "CLIENT_SECRET", true);

//   try {
//     const instruments = await deribit.getInstruments("ETH", "option");
//     console.log("Instruments (Test API):", instruments);
//   } catch (error) {
//     console.error("Error fetching instruments (Test API):", error.message);
//   }

//   try {
//     const buyResponse = await deribit.buy("ETH-11OCT24-2600-C", 1);
//     console.log("Buy Response (Test API):", buyResponse);
//   } catch (error) {
//     console.error("Error making buy order (Test API):", error.message);
//   }
// })();
