const Web3 = require("web3");
const {promisify} = require("util");
const axios = require('axios');
const sqlite3 = require("sqlite3").verbose();
const LCDClient = require('@palomachain/paloma.js').LCDClient;
const MsgExecuteContract = require('@palomachain/paloma.js').MsgExecuteContract;
const MnemonicKey = require('@palomachain/paloma.js').MnemonicKey;
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;

require("dotenv").config();

const FROM_BLOCK = process.env.PANCAKESWAP_V2_LOB_VYPER_START;


const PALOMA_LCD = process.env.PALOMA_LCD;
const PALOMA_CHAIN_ID = process.env.PALOMA_CHAIN_ID;
const PALOMA_PRIVATE_KEY = process.env.PALOMA_KEY;
const LOB_CW = process.env.LOB_CW;
const WETH = process.env.WETH;
const VETH = process.env.VETH;
const SLIPPAGE = process.env.SLIPPAGE;
const DENOMINATOR = 1000;
const MAX_SIZE = 8;
const PROFIT_TAKING = 1;
const STOP_LOSS = 2;




let web3 = null;
let contractInstance = null;
let COINGECKO_CHAIN_ID = null;
let networkName = null;
let connections = null;

async function setupConnections() {
    const data = await fs.readFile('./networks.json', 'utf8');
    const configs = JSON.parse(data);

    connections = configs.map(config => {
        const web3 = new Web3(config.NODE);
        return {
            web3: web3,
            contractInstance: new web3.eth.Contract(JSON.parse(config.ABI), config.VYPER),
            coingeckoChainId: config.COINGECKO_CHAIN_ID,
            networkName: config.NETWORK_NAME
        };
    });
}

setupConnections().then(r => {});

let db = new sqlite3.Database("./events.db");
db.serialize(() => {
    db.run(
        `CREATE TABLE IF NOT EXISTS fetched_blocks (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            block_number INTEGER
        );`
    );
    db.run(
        `CREATE TABLE IF NOT EXISTS deposits (
            deposit_id INTEGER NOT NULL,
            token0 TEXT NOT NULL,
            token1 TEXT NOT NULL,
            amount0 TEXT NOT NULL,
            amount1 TEXT NOT NULL,
            depositor TEXT NOT NULL,
            deposit_price REAL,
            tracking_price REAL,
            profit_taking INTEGER,
            stop_loss INTEGER,
            withdraw_type INTEGER,
            withdraw_block INTEGER,
            withdraw_amount TEXT,
            withdrawer TEXT
        );`);
    db.run(`CREATE INDEX IF NOT EXISTS deposit_idx ON deposits (deposit_id);`);

    db.run(`CREATE TABLE IF NOT EXISTS users(
    chat_id TEXT PRIMARY KEY,
    address TEXT NOT NULL
    )`);

    db.run(
        `ALTER TABLE fetched_blocks ADD COLUMN network_name TEXT;`,
        function(err) {
            if (err) {
                console.log("Column 'network_name' already exists in 'fetched_blocks'.");
            }
        }
    );

    db.run(
        `ALTER TABLE deposits ADD COLUMN network_name TEXT;`,
        function(err) {
            if (err) {
                console.log("Column 'network_name' already exists in 'deposits'.");
            }
        }
    );
});

db.getAsync = promisify(db.get).bind(db);
db.runAsync = promisify(db.run).bind(db);

// Fetch all deposited order.
// Fetch all withdrawn/canceled order.
// Find pending orders from above.
// Find pools list to fetch information.
// Fetch all pool information from Uniswap V3.
// Find executable IDs.
let processing = false;
let prices = {};

async function getLastBlock() {
    if (processing) {
        return 0
    } else {
        processing = true;
    }


    for (const connection of connections) {
        web3 = connection.web3;
        contractInstance = connection.contractInstance;
        COINGECKO_CHAIN_ID = connection.coingeckoChainId;
        networkName = connection.networkName;

        try {
            const row = await db.getAsync(`SELECT * FROM fetched_blocks WHERE network_name = ? AND ID = (SELECT MAX(ID) FROM fetched_blocks WHERE network_name = ?)`, [networkName, networkName]);
            let fromBlock = 0;
            if (row === undefined) {
                const data = [FROM_BLOCK - 1, networkName];
                await db.runAsync(`INSERT INTO fetched_blocks (block_number, network_name) VALUES (?, ?);`, data);

                fromBlock = Number(FROM_BLOCK);
            } else {
                fromBlock = row["block_number"] + 1;
            }

            await getNewBlocks(fromBlock);
        } catch (err) {
            console.error(err);
        }
    }
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function retryAxiosRequest(url, method, timeout, headers, maxRetries) {
    let error = null;

    for(let i = 0; i < maxRetries; i++) {
        try {
            return await axios({url, method, timeout, headers});
        } catch(err) {
            error = err;
            console.error(`Attempt ${i+1} failed. Retrying... in 30 seconds`);
            await delay(30 * 1000);
        }
    }
    throw new Error(`Maximum retries exceeded ${error}`);
}

async function getNewBlocks(fromBlock) {
    const block_number = Number(await web3.eth.getBlockNumber());
    let deposited_events = [];
    let withdrawn_events = [];

    for (let i = fromBlock; i <= block_number; i += 10000) {
        let toBlock = i + 9999;
        if (toBlock > block_number) {
            toBlock = block_number;
        }
        const new_deposited_events = await contractInstance.getPastEvents("Deposited", {
            fromBlock: i,
            toBlock: toBlock,
        });
        const new_withdrawn_events = await contractInstance.getPastEvents("Withdrawn", {
            fromBlock: i,
            toBlock: toBlock,
        });

        deposited_events = deposited_events.concat(new_deposited_events);
        withdrawn_events = withdrawn_events.concat(new_withdrawn_events);
    }

    let responses = [];


    prices = []; //clear cache
    for (let key in deposited_events) {
        let token1 = deposited_events[key].returnValues["token1"];
        if (token1 === VETH) {
            token1 = WETH;
        }


        responses.push(await retryAxiosRequest(
             `https://pro-api.coingecko.com/api/v3/simple/token_price/${COINGECKO_CHAIN_ID}?contract_addresses=${token1}&vs_currencies=usd&x_cg_pro_api_key=${process.env.COINGECKO_API_KEY}`,
             'get',
            8000,
             {
                'Content-Type': 'application/json',
            },
            2
        ));
    }


    for (const response of responses) {
        Object.keys(response.data).forEach(value => {
            let price_index = value;
            let value_object = response.data[value];

            if(value_object.usd !== undefined) {
                prices[price_index] = value_object.usd
            }
        });
    }

    for (let key in deposited_events) {
        let token1 = deposited_events[key].returnValues["token1"];
        if (token1 === VETH) {
            token1 = WETH;
        }
        deposited_events[key].returnValues["price"] = prices[token1.toLowerCase()];
    }
    db.serialize(() => {
        if (deposited_events.length !== 0) {
            let placeholders = deposited_events.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
            let sql = `INSERT INTO deposits (deposit_id, token0, token1, amount0, amount1, depositor, deposit_price, tracking_price, profit_taking, stop_loss, network_name) VALUES ` + placeholders + ";";
            let flat_array = [];
            for (let key in deposited_events) {
                flat_array.push(deposited_events[key].returnValues["deposit_id"]);
                flat_array.push(deposited_events[key].returnValues["token0"]);
                flat_array.push(deposited_events[key].returnValues["token1"]);
                flat_array.push(deposited_events[key].returnValues["amount0"]);
                flat_array.push(deposited_events[key].returnValues["amount1"]);
                flat_array.push(deposited_events[key].returnValues["depositor"]);
                flat_array.push(deposited_events[key].returnValues["price"]);
                flat_array.push(deposited_events[key].returnValues["price"]);
                flat_array.push(deposited_events[key].returnValues["profit_taking"]);
                flat_array.push(deposited_events[key].returnValues["stop_loss"]);
                flat_array.push(networkName);
            }
            db.run(sql, flat_array);
        }
        if (withdrawn_events.length !== 0) {
            let sql = `UPDATE deposits SET withdraw_block = ?, withdrawer = ?, withdraw_type = ?, withdraw_amount = ? WHERE deposit_id = ?;`;
            for (let key in withdrawn_events) {
                db.run(sql, [withdrawn_events[key].blockNumber, withdrawn_events[key].returnValues["withdrawer"], withdrawn_events[key].returnValues["withdraw_type"], withdrawn_events[key].returnValues["withdraw_amount"], withdrawn_events[key].returnValues["deposit_id"]]);
            }
        }

        let sql = `INSERT INTO fetched_blocks (block_number) VALUES (?);`;
        let data = [block_number];
        db.run(sql, data);
    });

    const deposits = await getAllDeposits();
    const withdrawDeposits = [];

    responses = [];

    for (let key in deposits) {
        if (deposits[key].withdraw_block === null) {
            let token1 = deposits[key].token1;
            if (token1 === VETH) {
                token1 = WETH;
            }
            if (prices[token1.toLowerCase()] === undefined) {
                responses.push(await retryAxiosRequest(
                    `https://pro-api.coingecko.com/api/v3/simple/token_price/${COINGECKO_CHAIN_ID}?contract_addresses=${token1}&vs_currencies=usd&x_cg_pro_api_key=${process.env.COINGECKO_API_KEY}`,
                    'get',
                    8000,
                     {
                        'Content-Type': 'application/json',
                    },
                    2
                ));
            }
        }
    }


    for (const response of responses) {
        Object.keys(response.data).forEach(value => {
            let price_index = value;
            let value_object = response.data[value];

            if(value_object.usd !== undefined) {
                prices[price_index] = value_object.usd
            }
        });
    }

    for (const deposit of deposits) {
        try {
            let withdrawDeposit = null;

            if (deposit.withdraw_block === null) {
                withdrawDeposit = processDeposit(deposit);
            }

            if (withdrawDeposit) {
                withdrawDeposit["min_amount0"] = await getMinAmount(deposit.depositor, withdrawDeposit.deposit_id);
                withdrawDeposits.push(withdrawDeposit);
            }

            if (withdrawDeposits.length >= MAX_SIZE) {
                break;
            }
        } catch (e) {
            console.log(e);
        }
    }

    if (withdrawDeposits.length > 0) {
        await executeWithdraw(withdrawDeposits);
    }

    processing = false;
}

async function getMinAmount(depositor, deposit_id) {
    let amount = await contractInstance.methods.cancel(deposit_id, 0).call({from: depositor});

    return web3.utils.toBN(amount).mul(web3.utils.toBN(Number(DENOMINATOR) - Number(SLIPPAGE))).div(web3.utils.toBN(DENOMINATOR)).toString();
}


function processDeposit(deposit) {
    let token1 = deposit.token1;
    if (token1 === VETH) {
        token1 = WETH;
    }

    let price = prices[token1.toLowerCase()];

    console.log('updatePrice', token1.toLowerCase(), deposit.deposit_id, price);
    updatePrice(deposit.deposit_id, price);
    if (Number(price) > Number(deposit.deposit_price) * (Number(DENOMINATOR) + Number(SLIPPAGE) + Number(deposit.profit_taking)) / Number(DENOMINATOR)) {
        return { "deposit_id": Number(deposit.deposit_id), "withdraw_type": PROFIT_TAKING};
    } else if (Number(price) < Number(deposit.deposit_price) * (Number(DENOMINATOR) + Number(SLIPPAGE) - Number(deposit.stop_loss)) / Number(DENOMINATOR)) {
        return { "deposit_id": Number(deposit.deposit_id), "withdraw_type": STOP_LOSS};
    }

    return null;
}

async function executeWithdraw(deposits) {
    console.log("executeWithdraw", deposits);
    const lcd = new LCDClient({
        URL: PALOMA_LCD,
        chainID: PALOMA_CHAIN_ID,
        classic: true,
    });
    const mk = new MnemonicKey({
        mnemonic: PALOMA_PRIVATE_KEY,
    });
    const wallet = lcd.wallet(mk);
    const msg = new MsgExecuteContract(
        wallet.key.accAddress,
        LOB_CW,
        {"put_withdraw": {"deposits": deposits}}
    );

    let result = null;

    try {
        const tx = await wallet.createAndSignTx({msgs: [msg]});
        result = await lcd.tx.broadcast(tx);

        try {
            deposits.forEach(deposit => {
                swapComplete(getChatIdByAddress(deposit.deposit_id));
            });
        } catch (e) {
            console.log(e);
        }
    } catch (e) {
        console.log(e);
    }

    return result;
}

async function getChatIdByAddress(address) {
    await db.get(`SELECT chat_id FROM users WHERE address = ?`, [address], (err, row) => {
        if (err) {
            console.error(err.message);
            return null;
        }
        if (row) {
            return row.chat_id;
        } else {
            return null;
        }
    });
}

async function getAllDeposits(depositor = null) {
    let dbAll = promisify(db.all).bind(db);

    try {
        let rows;
        if (depositor) {
            rows = await dbAll(`SELECT * FROM deposits WHERE depositor = ?`, depositor);
        } else {
            rows = await dbAll(`SELECT * FROM deposits`);
        }
        return rows;
    } catch (err) {
        console.error(err.message);
    }
}

function updatePrice(depositId, price) {
    db.run(
        `UPDATE deposits SET tracking_price = ? WHERE deposit_id = ?`,
        [price, depositId], null
    );
}

function processDeposits() {
    setInterval(getLastBlock, 1000 * 10);
}

let bot = null;

if (process.env.TELEGRAM_ID) {
    const token = process.env.TELEGRAM_ID;
    bot = new TelegramBot(token, {polling: true});

    bot.on('message', (msg) => {
        const chatId = msg.chat.id;
        db.get(`SELECT address FROM users WHERE chat_id = ?`, [chatId], (err, row) => {
            if (err) {
                console.error(err.message);
                return;
            }
            if (row) {
                bot.sendMessage(chatId, 'We already have your address. We will notify you when any of your swaps are complete.');
            } else {
                bot.sendMessage(chatId, 'Please provide your address');
            }
        });
    });

    bot.onText(/^(0x[a-fA-F0-9]{40})$/, (msg, match) => {
        const chatId = msg.chat.id;
        const address = match[1];
        db.run(`INSERT OR REPLACE INTO users(chat_id, address) VALUES(?, ?)`, [chatId, address], function (err) {
            if (err) {
                console.error(err.message);
                return;
            }
            bot.sendMessage(chatId, 'Address received! We will notify you when the swap is complete.');
        });
    });
} else {
    console.log("TELEGRAM_ID not set.. bot not going to connect.")
}

function swapComplete(chatId) {
    if(chatId !== undefined) {
        if (bot !== null) {
            bot.sendMessage(chatId, 'Your swap is complete!');
        }
    }
}

module.exports = {
    processDeposits,
    getAllDeposits
};
