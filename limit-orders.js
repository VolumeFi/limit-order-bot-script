const Web3 = require("web3");
const {promisify} = require("util");
const sqlite3 = require("sqlite3").verbose();
const LCDClient = require('@palomachain/paloma.js').LCDClient;
const MsgExecuteContract = require('@palomachain/paloma.js').MsgExecuteContract;
const MnemonicKey = require('@palomachain/paloma.js').MnemonicKey;
const TelegramBot = require('node-telegram-bot-api');

require("dotenv").config();

const BNB_NODE = process.env.BNB_NODE;
const LOB_VYPER = process.env.PANCAKESWAP_LOB_VYPER;
const LOB_ABI = JSON.parse(process.env.LOB_ABI);
const POOL_ABI = JSON.parse(process.env.UNISWAP_V2_POOL_ABI);
const FROM_BLOCK = process.env.UNISWAP_V3_LOB_VYPER_START;

const PALOMA_LCD = process.env.PALOMA_LCD;
const PALOMA_CHAIN_ID = process.env.PALOMA_CHAIN_ID;
const PALOMA_PRIVATE_KEY = process.env.PALOMA_PRIVATE_KEY;
const LOB_CW = process.env.LOB_CW;
const WETH = process.env.WETH;
const SLIPPAGE = process.env.SLIPPAGE;
const DENOMINATOR = 10000;
const MAX_SIZE = 64;

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
            amount1_min TEXT NOT NULL,
            amount1_max TEXT NOT NULL,
            pool TEXT NOT NULL,
            depositor TEXT NOT NULL,
            profit_taking_or_stop_loss NUMERIC,
            withdraw_block INTEGER,
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

async function getLastBlock() {
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
    db.serialize(() => {
        if (deposited_events.length != 0) {
            let placeholders = deposited_events.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
            let sql = `INSERT INTO deposits (deposit_id, token0, token1, amount0, amount1_min, amount1_max, pool, depositor) VALUES ` + placeholders + ";";
            let flat_array = [];
            for (let key in deposited_events) {
                flat_array.push(deposited_events[key].returnValues["deposit_id"]);
                flat_array.push(deposited_events[key].returnValues["token0"]);
                flat_array.push(deposited_events[key].returnValues["token1"]);
                flat_array.push(deposited_events[key].returnValues["amount0"]);
                flat_array.push(deposited_events[key].returnValues["amount1_min"]);
                flat_array.push(deposited_events[key].returnValues["amount1_max"]);
                flat_array.push(deposited_events[key].returnValues["pool"]);
                flat_array.push(deposited_events[key].returnValues["depositor"]);
            }
            db.run(sql, flat_array);
        }
        if (withdrawn_events.length != 0) {
            let sql = `UPDATE deposits SET withdraw_block = ?, withdrawer = ?, profit_taking_or_stop_loss = ? WHERE deposit_id = ?;`;
            for (let key in withdrawn_events) {
                db.run(sql, [withdrawn_events[key].blockNumber, withdrawn_events[key].returnValues["withdrawer"], withdrawn_events[key].returnValues["profit_taking_or_stop_loss"], withdrawn_events[key].returnValues["deposit_id"]]);
            }
        }
        let sql = `INSERT INTO fetched_blocks (block_number) VALUES (?);`;
        data = [block_number];
        db.run(sql, data);
        sql = `SELECT deposit_id, token0, token1, amount0, amount1_min, amount1_max, pool FROM deposits WHERE withdraw_block IS NULL;`;
        db.all(sql, (err, row) => {
            getDepositIds(row);
        });
    });
}

async function getDepositIds(row) {
    console.log("getDepositIds", row);
    let calls = [];
    let pools = [];
    let deposits = [];
    let reserves = [];

    for (let key in row) {
        if (!pools.includes(row[key].pool)) {
            let poolInstance = new web3.eth.Contract(POOL_ABI, row[key].pool);
            calls.push(poolInstance.methods.getReserves().call());
            pools.push(row[key].pool);
        }
    }

    const responses = await Promise.all(calls);

    for (let key in responses) {
        reserves[pools[key]] = {reserve0: responses[key]["_reserve0"], reserve1: responses[key]["_reserve1"]};
    }
    for (let key in row) {
        let token0 = row[key].token0;
        let token1 = row[key].token1;
        if (token0 == VETH) {
            token0 = WETH;
        }
        if (token1 == VETH) {
            token0 = WETH;
        }
        let reserve0 = web3.utils.toBN(reserves[row[key].pool].reserve0);
        let reserve1 = web3.utils.toBN(reserves[row[key].pool].reserve1);
        if (web3.utils.toBN(token0).gt(web3.utils.toBN(token1))) {
            const swaptemp = reserve0;
            reserve0 = reserve1;
            reserve1 = swaptemp;
        }
        const amount0 = web3.utils.toBN(row[key].amount0);
        const amount1_min = web3.utils.toBN(row[key].amount1_min).mul(web3.utils.toBN(SLIPPAGE).add(web3.utils.toBN(DENOMINATOR))).div(web3.utils.toBN(DENOMINATOR));
        const amount1_max = web3.utils.toBN(row[key].amount1_max).mul(web3.utils.toBN(SLIPPAGE).add(web3.utils.toBN(DENOMINATOR))).div(web3.utils.toBN(DENOMINATOR));
        const amount1 = amount0.mul(reserve1).mul(web3.utils.toBN(997)).div(reserve0.mul(web3.utils.toBN(1000)).add(amount0));

        await updateAmount1(row[key].deposit_id, amount1);

        if (amount1.gte(amount1_max)) {
            deposits.push({"deposit_id": Number(row[key].deposit_id), "profit_taking_or_stop_loss": true});
        } else if (amount1.lte(amount1_min)) {
            deposits.push({"deposit_id": Number(row[key].deposit_id), "profit_taking_or_stop_loss": false});
        }
        if (deposits.length >= MAX_SIZE) {
            break;
        }
    }
    if (deposits.length > 0) {
        await executeWithdraw(deposits);
    }
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

    const tx = await wallet.createAndSignTx({msgs: [msg]});
    const result = await lcd.tx.broadcast(tx);

    try {
        deposits.forEach(deposit => {
            swapComplete(getChatIdByAddress(deposit.deposit_id));
        });
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

async function updateAmount1(depositId, newAmount1) {
    await db.run(
        `UPDATE deposits SET amount1 = ? WHERE deposit_id = ?`,
        [newAmount1, depositId], null
    );
}

function processDeposits() {
    console.log("process deposits");
    setInterval(getLastBlock, 3000);
}

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
    db.run(`INSERT OR REPLACE INTO users(chat_id, address) VALUES(?, ?)`, [chatId, address], function(err) {
        if (err) {
            console.error(err.message);
            return;
        }
        bot.sendMessage(chatId, 'Address received! We will notify you when the swap is complete.');
    });
});

function swapComplete(chatId) {
    bot.sendMessage(chatId, 'Your swap is complete!');
}

module.exports = {
    processDeposits,
    getAllDeposits
};
