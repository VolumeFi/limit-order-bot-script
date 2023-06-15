#  Limit Order Bot on Paloma

This is a Node.js application that interacts with Binance Smart Chain (BSC) and Paloma Chain to automatically execute limit orders. It makes use of the PancakeSwap and Uniswap V3 protocols for creating and managing these limit orders.

## Installation

1. Clone this repository: `git clone https://github.com/VolumeFi/limit-order-bot-script `
2. Navigate into the project directory: `cd limit-order-bot-script`
3. Install the dependencies: `npm install`

## Environment Variables

You will need to set the following environment variables:

- `PALOMA_KEY`: The private key of the Paloma wallet
- `PALOMA_LCD`: The URL of the Paloma LCD
- `PALOMA_CHAIN_ID`: The ID of the Paloma chain
- `LOB_CW_CODE_ID`: The code id of the Limit Order Bot CosmWasm
- `SLIPPAGE`: The slippage rate
- `SENTRY`
- `TELEGRAM_ID`: The ID of the Telegram bot
- `PORT`
- `COINGECKO_API_KEY`

And you will need to set configuration in `networks.json`:

- `NODE`: The URL of the EVM chain node
- `ABI`: The ABI for the Limit Order Bot contract
- `VYPER`: The address of the Limit Order Bot contract
- `JOB_ID`: The job id of the Paloma job
- `CHAIN_TYPE`: Chain type. "evm" for EVM chains
- `CHAIN_REFERENCE_ID`: Chain reference id in Paloma
- `COINGECKO_CHAIN_ID`: Chain identifier in Coingecko API
- `NETWORK_NAME`: Network name on which the limit order bot
- `WETH`: Wrapped basecoin ERC20 token address
- `FROM_BLOCK`: The starting block of the Limit Order Bot contract
- `CW`: The address of the Limit Order Bot CosmWasm


## Usage

Run the program: `node index.js`

## Telegram Bot

The Telegram bot notifies users when their swaps are completed.

## API Endpoint

The application also provides an API endpoint (`/robots`) which returns all the limit orders in the system.

## Database

This application uses SQLite to store and manage limit orders and users.



# Limit Order Bot The Python Script

This Python application uses the Paloma SDK to interact with the Binance Smart Chain (BSC) and PancakeSwap to automatically execute limit orders. It makes use of the PancakeSwap's Limit Order Bot for creating and managing these limit orders.

## Prerequisites

You need Python 3.8 or above installed on your machine.

## Dependencies

```sh
pip install -r requirements.txt
```

## Running the bot

After setting the environment variables, you can run the bot using the following command:

```sh
python3 main.py
```

The bot will initialize, create a job on PancakeSwap's Limit Order Bot, and then instantiate a contract to execute the limit order job. The result of each operation will be printed to the console.

This bot uses the asyncio and uvloop libraries for asynchronous execution, and the web3 library for interacting with the Ethereum-based BSC. It also uses the os and dotenv libraries to read environment variables and the json library to parse the ABI.
