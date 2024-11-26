import config from "../config.json";
import commandLineArgs from "command-line-args";
import { VaultManager } from "./vault_manager";
import {
  createVaultOperationDefinitions,
  detailedVaultOperationDefinitions,
  simpleVaultOperationDefinitions,
  addressOperationDefinitions,
} from "./constants";

function commandLineErrorWithMessage(command: string) {
  return new Error(`Command line arguments of "${command}" is invalid.`);
}

async function main() {
  // Determine which network to operate on
  const networkOptions = commandLineArgs(
    [{ name: "network", alias: "n", defaultOption: true }],
    { stopAtFirstUnknown: true },
  );
  const mainArgv = networkOptions._unknown || [];

  if (!Object.keys(config).includes(networkOptions.network)) {
    console.error(`Invalud network "${networkOptions.network}"`);
    process.exit(1);
  }
  console.log(`Running on ${networkOptions.network}`);

  // Initiate VaultManager
  const vaultManager = new VaultManager(
    config[networkOptions.network],
    config.basicSettings,
  );

  // Handle sub-commands
  const commandOptions = commandLineArgs(
    [{ name: "command", defaultOption: true }],
    {
      argv: mainArgv,
      stopAtFirstUnknown: true,
    },
  );
  const commandArgv = commandOptions._unknown || [];

  // NOTE: pattern of each case
  // 1. Define arguments of a sub-command
  // 2. Parse the arguments
  // 3. Validate the arguments, fail fast when not all of them are valid
  // 4. Feed the arguments to corresponding sub-command
  switch (commandOptions.command) {
    case "createVault": {
      const createVaultOptions = commandLineArgs(
        createVaultOperationDefinitions,
        {
          argv: commandArgv,
        },
      );

      // NOTE: we don't check isBuyLow here because it's either true or false
      const valid =
        createVaultOptions.linkedPrice &&
        createVaultOptions.quantity &&
        createVaultOptions.expiry &&
        createVaultOptions.yieldPercentage &&
        createVaultOptions.tradingPair;

      if (!valid) {
        throw commandLineErrorWithMessage(commandOptions.command);
      }

      await vaultManager.createVault(createVaultOptions);
      break;
    }
    case "cancelVault": {
      const cancelVaultOptions = commandLineArgs(
        simpleVaultOperationDefinitions,
        {
          argv: commandArgv,
        },
      );

      const valid = cancelVaultOptions.vault;

      if (!valid) {
        throw commandLineErrorWithMessage(commandOptions.command);
      }

      await vaultManager.cancelVault(cancelVaultOptions.vault);
      break;
    }
    case "subscribeVault": {
      const subscribeVaultOptions = commandLineArgs(
        detailedVaultOperationDefinitions,
        {
          argv: commandArgv,
        },
      );

      const valid = subscribeVaultOptions.vault && subscribeVaultOptions.amount;

      if (!valid) {
        throw commandLineErrorWithMessage(commandOptions.command);
      }

      await vaultManager.subscribeVault(
        subscribeVaultOptions.vault,
        subscribeVaultOptions.amount,
      );
      break;
    }
    case "withdrawVault": {
      const withdrawVaultOptions = commandLineArgs(
        simpleVaultOperationDefinitions,
        {
          argv: commandArgv,
        },
      );

      const valid = withdrawVaultOptions.vault;

      if (!valid) {
        throw commandLineErrorWithMessage(commandOptions.command);
      }

      await vaultManager.withdrawVault(withdrawVaultOptions.vault, false);
      break;
    }
    case "lpWithdrawVault": {
      const withdrawVaultOptions = commandLineArgs(
        simpleVaultOperationDefinitions,
        {
          argv: commandArgv,
        },
      );

      const valid = withdrawVaultOptions.vault;

      if (!valid) {
        throw commandLineErrorWithMessage(commandOptions.command);
      }

      await vaultManager.withdrawVault(withdrawVaultOptions.vault, true);
      break;
    }
    case "lpWithdrawAllVaults":
      await vaultManager.withdrawAllVaults(true);
      break;
    case "subscriberWithdrawAllVaults":
      await vaultManager.withdrawAllVaults(false);
      break;
    case "showConfig":
      await vaultManager.showConfig();
      break;
    case "listAllVaults": {
      const listAllVaultsOptions = commandLineArgs(
        addressOperationDefinitions,
        {
          argv: commandArgv,
        },
      );

      const valid = listAllVaultsOptions.address;

      if (!valid) {
        throw commandLineErrorWithMessage(commandOptions.command);
      }

      await vaultManager.listAllVaults(listAllVaultsOptions.address);
      break;
    }
    case "showVault": {
      const showVaultOptions = commandLineArgs(
        simpleVaultOperationDefinitions,
        {
          argv: commandArgv,
        },
      );

      const valid = showVaultOptions.vault;

      if (!valid) {
        throw commandLineErrorWithMessage(commandOptions.command);
      }

      await vaultManager.showVault(showVaultOptions.vault);
      break;
    }
    default:
      console.error("Command not found");
  }
}

main();
