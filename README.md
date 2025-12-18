# Prodigy.Fi Dual Investment Command Line Tool

## Prepare
1. Install the dependencies:
```bash
npm i
```

2. Prepare wallet configuration:
   - Put your encrypted wallet JSON file in the ./keystore directory
   - Update the config file with:
     - `jsonWallet`: Your encrypted wallet JSON filename
     - `passphrase`: The passphrase for your encrypted wallet

   If you don't have an encrypted wallet JSON file, you can create one:
   ```bash
   npx ts-node ./src/encrypt_wallet.ts
   ```
   This will create an encrypted wallet JSON file with a passphrase that you specify to the keystore directory.

## Vault operations using `main.ts`
Run the program `npx ts-node ./src/main.ts "<Bera Testnet|Bera Mainnet>" <COMMAND>`.

- `COMMAND`:
  - `createVault --tradingPair <trading pair> --linkedPrice <price> --quantity <quantity> --expiry <UNIX epoch> --yieldPercentage <yield rate> [--isBuyLow] [--useCollateralPool] [--vaultSeriesVersion <version>] [--signer <address>]`: Create a vault with command line arguments. The `--vaultSeriesVersion` defaults to 1 if not specified. The `--signer` option is only supported for vault series version 2+; if not specified, it defaults to the owner address.
  - `cancelVault --vault <vault address>`: Cancel a specific vault
  - `cancelMultipleVaults --vault <vault address> [--bypassCheck]`: Cancel multiple vaults in batch
  - `approveVault --vault <vault address> --approve <true|false>`: Approve a specific to use collateral pool or not
  - `adjustVaultYield --vault <vault address> --yieldPercentage <yield rate>`: Change yield for specific vault
  - `subscribeVault --vault <vault address> --amount <amount>`: Subscribe a specific vault with amount
  - `withdrawVault --vault <vault address>`: Withdraw a specific vault
  - `lpWithdrawVault --vault <vault address>`: Withdraw a specific vault by the LP
  - `withdrawMultipleVaults --vault <vault address> [--bypassCheck]`: Withdraw multiple vaults with same trading pair and expiry
  - `lpWithdrawMultipleVaults --vault <vault address> [--bypassCheck]`: Withdraw multiple vaults by the LP with same trading pair and expiry
  - `showConfig`: display settings
  - `listAllVaults --address <LP address> [--start <start index>] [--count <number of vaults>]`: List vaults created by the LP. With no extra flags the command returns every deployed vault owned by the address.
    - `start` is a zero-based index of the first vault to inspect; `count` is how many consecutive vaults to read from that index.
    - Leave `start` unset but pass `--count N` to fetch the latest `N` vaults: `listAllVaults --address <LP> --count 20`.
    - Specify both to page through history, e.g. `listAllVaults --address <LP> --start 200 --count 50`.
  - `showVault --vault <vault address>`: display vault parameters

## Create vaults in batch using `batch_runner.ts`
1. Put `create-vaults.csv` in the root directory of the toolkit. The file must have 8 columns, for example:

| Creation Date | Network      | Trading Pair | Linked Price | Yield Percentage | Expire Date | Direction | Quantity |
| ------------- | ------------ | ------------ | ------------:| ----------------:| ----------- | --------- | --------:|
| 2024/08/24    | Bera Testnet | WETH-USDC    |         3000 |               1% | 2024/08/30  | Buy Low   |      100 |
| 2024/08/25    | Bera Testnet | WETH-USDC    |         3200 |             1.1% | 2024/08/30  | Sell High |        1 |

2. Then run the program:
    ```bash
    npx ts-node ./src/batch_runner.ts
    ```
