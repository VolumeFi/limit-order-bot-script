#  Limit Order Bot on Paloma

This is a Node.js application that interacts with Binance Smart Chain (BSC) and Paloma Chain to automatically execute limit orders. It makes use of the PancakeSwap and Uniswap V3 protocols for creating and managing these limit orders.

## Installation

1. Clone this repository: `git clone https://github.com/username/CryptoSwapBot.git`
2. Navigate into the project directory: `cd CryptoSwapBot`
3. Install the dependencies: `npm install`

## Environment Variables

You will need to set the following environment variables:

- `BNB_NODE`: The URL of the BSC node
- `PANCAKESWAP_LOB_VYPER`: The address of the PancakeSwap Limit Order Book contract
- `LOB_ABI`: The ABI for the Limit Order Book contract
- `UNISWAP_V2_POOL_ABI`: The ABI for the Uniswap V2 Pool contract
- `UNISWAP_V3_LOB_VYPER_START`: The starting block of the Uniswap V3 Limit Order Book contract
- `PALOMA_LCD`: The URL of the Paloma LCD
- `PALOMA_CHAIN_ID`: The ID of the Paloma chain
- `PALOMA_PRIVATE_KEY`: The private key of the Paloma wallet
- `LOB_CW`: The address of the Limit Order Book Contract Wrapper
- `WETH`: The address of the Wrapped Ethereum (WETH) contract
- `SLIPPAGE`: The slippage rate
- `TELEGRAM_ID`: The ID of the Telegram bot

## Usage

Run the program: `node index.js`

## Telegram Bot

The Telegram bot notifies users when their swaps are completed.

## API Endpoint

The application also provides an API endpoint (`/robots`) which returns all the limit orders in the system.

## Database

This application uses SQLite to store and manage limit orders and users.



# Limit Order Bot The Python Script

This Python application uses the Paloma SDK to interact with the Binance Smart Chain (BSC) and PancakeSwap to automatically execute limit orders. It makes use of the PancakeSwap's Limit Order Book for creating and managing these limit orders.

## Prerequisites

You need Python 3.8 or above installed on your machine. Also, you need to have the following environment variables set:

- `BNB_NODE`: The URL of your Binance Smart Chain node.
- `PANCAKESWAP_LOB_VYPER`: The address of the PancakeSwap limit order book contract.
- `PANCAKESWAP_LOB_ABI`: The ABI of the PancakeSwap limit order book contract.
- `PALOMA_LCD`: The URL of your Paloma LCD.
- `PALOMA_CHAIN_ID`: The ID of your Paloma Chain.
- `PALOMA_KEY`: The mnemonic phrase of your Paloma wallet.
- `PANCAKESWAP_LOB_JOB_ID`: The ID of the PancakeSwap limit order book job.
- `PANCAKESWAP_CHAIN_TYPE`: The type of the PancakeSwap chain.
- `PANCAKESWAP_CHAIN_REFERENCE_ID`: The reference ID of the PancakeSwap chain.
- `LOB_CW_CODE_ID`: The code ID of the limit order book contract.

## Dependencies

```sh
pip install -r requirements.txt
```

## Running the bot

After setting the environment variables, you can run the bot using the following command:

```sh
python3 main.py
```

The bot will initialize, create a job on PancakeSwap's limit order book, and then instantiate a contract to execute the limit order job. The result of each operation will be printed to the console.

This bot uses the asyncio and uvloop libraries for asynchronous execution, and the web3 library for interacting with the Ethereum-based BSC. It also uses the os and dotenv libraries to read environment variables and the json library to parse the ABI.
