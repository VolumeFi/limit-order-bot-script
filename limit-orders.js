const Web3 = require("web3");
const {promisify} = require("util");
const axios = require('axios');
const sqlite3 = require("sqlite3").verbose();
const LCDClient = require('@palomachain/paloma.js').LCDClient;
const MsgExecuteContract = require('@palomachain/paloma.js').MsgExecuteContract;
const MnemonicKey = require('@palomachain/paloma.js').MnemonicKey;
const TelegramBot = require('node-telegram-bot-api');

require("dotenv").config();

const BNB_NODE = process.env.BNB_NODE;
const LOB_VYPER = process.env.PANCAKESWAP_LOB_VYPER;
const LOB_ABI = JSON.parse(process.env.LOB_ABI);
const FROM_BLOCK = process.env.PANCAKESWAP_V2_LOB_VYPER_START;

const COINGECKO_CHAIN_ID = process.env.COINGECKO_CHAIN_ID;
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

const web3 = new Web3(BNB_NODE);
const contractInstance = new web3.eth.Contract(LOB_ABI, LOB_VYPER);

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
});

// Fetch all deposited order.
// Fetch all withdrawn/canceled order.
// Find pending orders from above.
// Find pools list to fetch information.
// Fetch all pool information from Uniswap V3.
// Find executable IDs.
let processing = false;
let prices = [];

async function getLastBlock() {
    if (processing) {
        return 0
    } else {
        processing = true;
    }


    let fromBlock = 0;

    db.get(`SELECT * FROM fetched_blocks WHERE ID = (SELECT MAX(ID) FROM fetched_blocks)`, (err, row) => {
        if (row == undefined) {
            data = [FROM_BLOCK - 1];
            db.run(`INSERT INTO fetched_blocks (block_number) VALUES (?);`, data);
            fromBlock = Number(FROM_BLOCK);
        } else {
            fromBlock = row["block_number"] + 1;
        }
        getNewBlocks(fromBlock);
    });
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function retryAxiosRequest(url, method, timeout, headers, maxRetries) {
    for(let i = 0; i < maxRetries; i++) {
        try {
            const response = await axios({ url, method, timeout, headers });
            return response;
        } catch(err) {
            console.log(err);
            //console.error(`Attempt ${i+1} failed. Retrying... in 30 seconds`);
            await delay(30 * 1000);
        }
    }
    throw new Error('Maximum retries exceeded');
}

async function getNewBlocks(fromBlock) {
    console.log("getNewBlocks", fromBlock);
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

    let addresses = [];
    let responses = [];

    for (let key in deposited_events) {
        let token1 = deposited_events[key].returnValues["token1"];
        if (token1 == VETH) {
            token1 = WETH;
        }
        if (prices[token1] === undefined) {
            responses.push(await retryAxiosRequest(
                 `https://pro-api.coingecko.com/api/v3/simple/token_price/${COINGECKO_CHAIN_ID}?contract_addresses=${token1}&vs_currencies=usd&x_cg_pro_api_key=${process.env.COINGECKO_API_KEY}`,
                 'get',
                8000,
                 {
                    'Content-Type': 'application/json',
                },
                2
            ));
            addresses.push(token1);

            await delay(500);

            tpm = tpm + 1;

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

    for (let key in deposited_events) {
        let token1 = deposited_events[key].returnValues["token1"];
        if (token1 == VETH) {
            token1 = WETH;
        }
        deposited_events[key].returnValues["price"] = prices[token1];
    }
    db.serialize(() => {
        if (deposited_events.length != 0) {
            let placeholders = deposited_events.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
            let sql = `INSERT INTO deposits (deposit_id, token0, token1, amount0, amount1, depositor, deposit_price, tracking_price, profit_taking, stop_loss) VALUES ` + placeholders + ";";
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
            }
            db.run(sql, flat_array);
        }
        if (withdrawn_events.length != 0) {
            let sql = `UPDATE deposits SET withdraw_block = ?, withdrawer = ?, withdraw_type = ?, withdraw_amount = ? WHERE deposit_id = ?;`;
            for (let key in withdrawn_events) {
                db.run(sql, [withdrawn_events[key].blockNumber, withdrawn_events[key].returnValues["withdrawer"], withdrawn_events[key].returnValues["withdraw_type"], withdrawn_events[key].returnValues["withdraw_amount"], withdrawn_events[key].returnValues["deposit_id"]]);
            }
        }

        let sql = `INSERT INTO fetched_blocks (block_number) VALUES (?);`;
        data = [block_number];
        db.run(sql, data);
    });

    const deposits = await getAllDeposits();
    const withdrawDeposits = [];

    responses = [];
    addresses = [];

    for (let key in deposits) {
        if (deposits[key].withdraw_block === null) {
            let token1 = deposits[key].token1;
            if (token1 == VETH) {
                token1 = WETH;
            }
            if (prices[token1] === undefined) {
                responses.push(await retryAxiosRequest(
                    `https://pro-api.coingecko.com/api/v3/simple/token_price/${COINGECKO_CHAIN_ID}?contract_addresses=${token1}&vs_currencies=usd&x_cg_pro_api_key=${process.env.COINGECKO_API_KEY}`,
                    'get',
                    8000,
                     {
                        'Content-Type': 'application/json',
                    },
                    2
                ));
                addresses.push(token1);

                await delay(500);

                tpm = tpm + 1;

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

    calls = [];

    for (const deposit of deposits) {
        let withdrawDeposit = null;

        if(deposit.withdraw_block === null) {
            withdrawDeposit = processDeposit(deposit);
        }

        if(withdrawDeposit) {
            withdrawDeposits.push(withdrawDeposit);
            calls.push(getMinAmount(withdrawDeposit.deposit_id))
        }
        if (withdrawDeposits.length >= MAX_SIZE) {
            break;
        }
    }

    responses = await Promise.all(calls);

    for (let key in withdrawDeposits) {
        withdrawDeposits[key]["min_amount0"] = responses[key];
    }

    if (withdrawDeposits.length > 0) {
        await executeWithdraw(withdrawDeposits);
    }

    processing = false;
}

async function getMinAmount(deposit_id) {
    let amount = await contractInstance.methods.withdraw_amount().call();
    return web3.utils.toBN(amount).mul(web3.utils.toBN(Number(DENOMINATOR) - Number(SLIPPAGE)).div(web3.utils.toBN(DENOMINATOR))).toString();
}


function processDeposit(deposit) {
    console.log("processDeposit");
    let token1 = deposit.token1;
    if (token1 == VETH) {
        token1 = WETH;
    }
    let price = prices[token1];

    updatePrice(deposit.deposit_id, price);
    if (Number(price) > Number(deposit.deposit_price) * (Number(DENOMINATOR) + Number(SLIPPAGE) + Number(deposit.profit_taking)) / Number(DENOMINATOR)) {
        return {"deposit_id": Number(deposit.deposit_id), "withdraw_type": PROFIT_TAKING};
    } else if (Number(price) < Number(deposit.deposit_price) * (Number(DENOMINATOR) + Number(SLIPPAGE) - Number(deposit.stop_loss)) / Number(DENOMINATOR)) {
        return {"deposit_id": Number(deposit.deposit_id), "withdraw_type": STOP_LOSS};
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
    console.log('updatePrice');
    db.run(
        `UPDATE deposits SET tracking_price = ? WHERE deposit_id = ?`,
        [price, depositId], null
    );
}

function processDeposits() {
    console.log("process deposits");
    setInterval(getLastBlock, 3000);
}

let tpm = 0;

function trans_per_minute() {
    console.log(`tpm: ${tpm}`);
    tpm = 0;
}

setInterval(trans_per_minute, 60 * 1000);

if (process.env.TELEGRAM_ID) {
    const token = process.env.TELEGRAM_ID;
    const bot = new TelegramBot(token, {polling: true});

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
    bot.sendMessage(chatId, 'Your swap is complete!');
}

module.exports = {
    processDeposits,
    getAllDeposits
};
