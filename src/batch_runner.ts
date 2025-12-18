import { existsSync, promises as fs } from "fs";
import process from "process";
import { parse } from "csv-parse/sync";
import moment from "moment-timezone";
import { execSync } from "child_process";

const DATA_SOURCE_FILE = "create-vaults.csv";
const LOG_FILE = "batch_runner.log";

const networkOptions = [
  "Base Testnet",
  "Base Mainnet",
  "Bera Testnet",
  "Bera Mainnet",
  "Ethereum Testnet",
  "Ethereum Mainnet",
];

const tradingPairOptions = [
  "WETH-USDC",
  "WBTC-USDC",
  "cbBTC-USDC",
  "WSOL-USDC",
  "DOGE-USDC",
  "SHIB-USDC",
  "PEPE-USDC",
  "VIRTUAL-USDC",
  "WBERA-USDC",
  "WETH-USDC.e",
  "WBTC-USDC.e",
  "WSOL-USDC.e",
  "DOGE-USDC.e",
  "SHIB-USDC.e",
  "PEPE-USDC.e",
  "VIRTUAL-USDC.e",
  "WBERA-USDC.e",
];

const directionOptions = ["Buy Low", "Sell High"];

const extractPercentage = (percentage: string) => {
  return percentage.slice(0, percentage.length - 1);
};

const reportError = (index, message) => {
  console.error(`Line ${index + 1}: ${message}`);
};

const isToday = (momentTimezoneObj) => {
  return (
    momentTimezoneObj.format("YYYY-MM-DD") ===
    moment.tz("Asia/Taipei").format("YYYY-MM-DD")
  );
};

function validate(dataSet): boolean {
  let valid = true;

  for (const [index, line] of dataSet.entries()) {
    // Skip the header
    if (index === 0) continue;

    const [
      creationDate,
      network,
      tradingPair,
      linkedPrice,
      yieldPercentage,
      expireDate,
      direction,
      quantity,
    ] = line;

    // Check dates
    if (!creationDate.isValid()) {
      reportError(index, `Creation date is invalid`);
      valid = false;
    }

    if (!expireDate.isValid()) {
      reportError(index, `Expire date is invalid`);
      valid = false;
    }

    if (creationDate.isSameOrAfter(expireDate)) {
      reportError(
        index,
        `Creation date ${creationDate} should be before expire date ${expireDate}`,
      );
      valid = false;
    }

    // Check network
    if (!networkOptions.includes(network)) {
      reportError(index, `Network ${network} is invalid`);
      valid = false;
    }

    // Check trading pair
    if (!tradingPairOptions.includes(tradingPair)) {
      reportError(index, `Trading pair ${tradingPair} is invalid`);
      valid = false;
    }

    // Check linkedPrice
    if (isNaN(linkedPrice)) {
      reportError(index, `Linked price is invalid`);
      valid = false;
    }

    // Check yieldPercentage
    if (yieldPercentage[yieldPercentage.length - 1] != "%") {
      reportError(index, `Yield percentage must end with '%'`);
      valid = false;
    }

    if (isNaN(parseFloat(extractPercentage(yieldPercentage)))) {
      reportError(index, `Yield percentage is invalid`);
      valid = false;
    }

    // Check direction
    if (!directionOptions.includes(direction)) {
      reportError(index, `Direction ${direction} is invalid`);
      valid = false;
    }

    // Check quantity
    if (isNaN(quantity)) {
      reportError(index, `Quantity is invalid`);
      valid = false;
    }
  }
  return valid;
}

async function createVaults(dataSet) {
  let processed = false;
  for (const [index, line] of dataSet.entries()) {
    // Skip the header
    if (index === 0) continue;

    const [
      creationDate,
      network,
      tradingPair,
      linkedPrice,
      yieldPercentage,
      expireDate,
      direction,
      quantity,
    ] = line;

    // ONLY process vault creations of today
    // Note that we assume all dates are with Asia/Taipei
    if (!isToday(creationDate)) {
      continue;
    }

    // Set the expiry to 4pm of the same day
    const exactExpiration = expireDate.hour(16).minute(0).second(0).unix();
    const buyLowFlag = direction === directionOptions[0] ? "--isBuyLow" : "";

    // TODO: the command line only works under POSIX-compliant systems; additional efforts are required for Win32
    const commandLine = `npx ts-node ./src/main.ts "${network}" createVault -t ${tradingPair} -p ${linkedPrice} -q ${quantity} -e ${exactExpiration} -y ${extractPercentage(yieldPercentage)} ${buyLowFlag} 2>&1 | tee -a ${LOG_FILE}`;

    // Do not really invoke main.ts in dry-run mode
    if (process.argv.length === 3 && process.argv[2] === "--dry-run") {
      console.log(
        `DRY RUN mode, we are not really running the command: ${commandLine}`,
      );
      continue;
    }

    const result = execSync(commandLine);
    processed = true;
    console.log("Data No.", index + 1, tradingPair, direction);
    console.log(result.toString());
  }
  if (!processed) {
    console.log(
      "No task processed. Please check if there is a vault creation for today.",
    );
  }
}

async function main() {
  const configFilePath = `${process.cwd()}/${DATA_SOURCE_FILE}`;

  // Check existence of config file
  if (!existsSync(configFilePath)) {
    console.error(`Config file '${configFilePath}' does not exist.`);
    process.exit(1);
  }

  const content = await fs.readFile(configFilePath);
  const dataSet = parse(content, {
    bom: true,
    trim: true,
    cast: function (value, context) {
      // Pass-through values of the first row as header
      if (context.header) return value;

      switch (context.index) {
        // Creation date
        case 0:
          return moment.tz(value, ["YYYY-MM-DD", "YYYY/MM/DD"], "Asia/Taipei");
        // Network
        case 1:
          return value;
        // Trading pair
        case 2:
          return value;
        // Linked price
        case 3:
          return parseFloat(value);
        // Yield percentage
        case 4:
          return value;
        // Expire date
        case 5:
          return moment.tz(value, ["YYYY-MM-DD", "YYYY/MM/DD"], "Asia/Taipei");
        // Direction
        case 6:
          return value;
        // Quantity
        case 7:
          return parseFloat(value);
        default:
          console.error(`Invalid column index ${context.index}`);
          process.exit(1);
      }
    },
  });

  if (!validate(dataSet)) {
    console.error("One or more line(s) need corrections.");
    process.exit(1);
  }
  await createVaults(dataSet);
}

main();
