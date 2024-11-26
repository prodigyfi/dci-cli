import { ethers } from "ethers";
import { writeFileSync } from "fs";
import { existsSync, mkdirSync } from "fs";
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function createJsonWallet() {
  try {
    // Create wallet from private key
    const privateKey = await new Promise<string>((resolve) => {
      rl.question("Enter your private key: ", resolve);
    });

    // Get passphrase
    const passphrase = await new Promise<string>((resolve) => {
      rl.question("Enter your passphrase: ", resolve);
    });

    // Confirm passphrase
    const confirmPassphrase = await new Promise<string>((resolve) => {
      rl.question("Confirm your passphrase: ", resolve);
    });

    if (passphrase !== confirmPassphrase) {
      throw new Error("Passphrases do not match");
    }

    // Create wallet
    const wallet = new ethers.Wallet(privateKey);
    console.log("Wallet address:", wallet.address);

    // Encrypt and save
    const encryptedJson = await wallet.encrypt(passphrase);

    // Create keystore directory if it doesn't exist
    const keystoreDir = "keystore";
    if (!existsSync(keystoreDir)) {
      mkdirSync(keystoreDir, { recursive: true });
    }

    // Save encrypted wallet to keystore
    const path = `${keystoreDir}/${wallet.address}.json`;
    writeFileSync(path, encryptedJson);
    console.log(`Encrypted wallet saved to ${path}`);
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    rl.close();
  }
}

createJsonWallet();
