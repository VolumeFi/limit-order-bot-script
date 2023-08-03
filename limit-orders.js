const Web3 = require("web3");
const { promisify } = require("util");
const axios = require('axios');
const sqlite3 = require("sqlite3").verbose();
const LCDClient = require('@palomachain/paloma.js').LCDClient;
const MsgExecuteContract = require('@palomachain/paloma.js').MsgExecuteContract;
const MnemonicKey = require('@palomachain/paloma.js').MnemonicKey;
const geckoTokens = require("./gecko.json");
const fs = require('fs').promises;

require("dotenv").config();

const PALOMA_LCD = process.env.PALOMA_LCD;
const PALOMA_CHAIN_ID = process.env.PALOMA_CHAIN_ID;
const PALOMA_PRIVATE_KEY = process.env.PALOMA_KEY;
const TELEGRAM_ALERT_API = process.env.TELEGRAM_ALERT_API;

const VETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const SLIPPAGE = process.env.SLIPPAGE;
const DENOMINATOR = 1000;
const MAX_SIZE = 8;
const PROFIT_TAKING = 2;
const STOP_LOSS = 4;
const BOT_NAME = 'Limit Order';
const WithdrawType = {
    SUCCESS: 1, // All success withdrawn type.
    EXPIRED: 2, // For Limit order, Stop loss bot type.
    REMAINING: 3 // For DCA bot type.
};

let WETH = null;
let web3 = null;
let contractInstance = null;
let COINGECKO_CHAIN_ID = null;
let networkName = null;
let connections = null;
let FROM_BLOCK = null;
let LOB_CW = null;
let DEX = null;
let BOT = "limitOrder";
let ADDRESS = null;
let OLD = false;

const mixpanel = require('mixpanel').init('eaae482845dadd88e1ce07b9fa03dd6b');


let configs = null;

async function setupConnections() {
    const data = await fs.readFile('./networks.json', 'utf8');

    configs = JSON.parse(data);
}

setupConnections().then(r => { });

let db = new sqlite3.Database(process.env.DB_LOCATION);
//SELECT * FROM deposits WHERE contract COLLATE NOCASE = '0x4495467f9cD04faF5fa65ed34AF335d4e2e7e129';
db.getAsync = promisify(db.get).bind(db);
db.runAsync = promisify(db.run).bind(db);

db.serialize(() => {
    db.run(
        `CREATE TABLE IF NOT EXISTS fetched_blocks (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            block_number INTEGER,
            network_name TEXT,
            dex TEXT,
            bot TEXT
        );`
    );
    db.run(
        `CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    withdrawer TEXT,
    network_name TEXT,
    dex_name TEXT,
    bot TEXT
);`);
    db.run(`CREATE INDEX IF NOT EXISTS deposit_idx ON deposits (deposit_id);`);

    db.run(`CREATE TABLE IF NOT EXISTS users(
    chat_id TEXT PRIMARY KEY,
    address TEXT NOT NULL
    )`);


});

// Fetch all deposited order.
// Fetch all withdrawn/canceled order.
// Find pending orders from above.
// Find pools list to fetch information.
// Fetch all pool information from Uniswap V3.
// Find executable IDs.
let processing = false;
let prices = {};

async function updateTables() {
    try {
        await db.getAsync(`ALTER TABLE fetched_blocks ADD COLUMN contract_instance TEXT;`);
    }
    catch (e) {

    }

    try {
        await db.getAsync(`ALTER TABLE deposits ADD COLUMN contract TEXT;`);
    }
    catch (e) {

    }

    try {
        await db.getAsync(`ALTER TABLE deposits ADD COLUMN old TEXT;`);
    }
    catch (e) {

    }
}

async function getLastBlock() {
    if (processing) {
        return 0
    } else {
        processing = true;
    }

    await updateTables();

    for (const config of configs) {
        web3 = new Web3(config.NODE);
        contractInstance = new web3.eth.Contract(JSON.parse(config.ABI), config.VYPER);
        ADDRESS = config.VYPER;
        COINGECKO_CHAIN_ID = config.COINGECKO_CHAIN_ID;
        networkName = config.NETWORK_NAME;
        WETH = config.WETH;
        FROM_BLOCK = config.FROM_BLOCK;
        LOB_CW = config.CW;
        DEX = config.DEX;
        OLD = config.OLD || false;
        prices[networkName] = [];

        try {
            const row = await db.getAsync(`SELECT * FROM fetched_blocks WHERE network_name = ? AND dex = ? AND bot = ? AND contract_instance = ? AND ID = (SELECT MAX(ID) FROM fetched_blocks WHERE network_name = ? AND dex = ? AND bot = ? AND contract_instance = ?)`, [networkName, DEX, BOT, ADDRESS, networkName, DEX, BOT, ADDRESS]);
            let fromBlock = 0;
            if (row === undefined) {
                const data = [FROM_BLOCK - 1, networkName, DEX, BOT, ADDRESS];
                await db.runAsync(`INSERT INTO fetched_blocks (block_number, network_name, dex, bot, contract_instance) VALUES (?, ?, ?, ?, ?);`, data);

                fromBlock = Number(FROM_BLOCK);
            } else {
                fromBlock = row["block_number"] + 1;
            }



            await getNewBlocks(fromBlock);
        } catch (err) {
            console.error(err);
        }
        await delay(6 * 1000);
    }

    processing = false;
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function retryAxiosRequest(url, method, timeout, headers, maxRetries) {
    let error = null;

    for (let i = 0; i < maxRetries; i++) {
        try {
            return await axios({ url, method, timeout, headers });
        } catch (err) {
            error = err;
            console.error(`Attempt ${i + 1} failed. Retrying... in 30 seconds`);
            await delay(30 * 1000);
        }
    }
    throw new Error(`Maximum retries exceeded ${error}`);
}

async function canAddDeposit(swap_id) {
    const row = await db.getAsync(`SELECT COUNT(*) as count FROM deposits WHERE deposit_id = ? AND network_name = ? AND dex_name = ? AND bot = ?`, [swap_id, networkName, DEX, BOT]);

    return row.count === 0;
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

    for (const deposited_event of deposited_events) {
        let token1 = deposited_event.returnValues["token1"];
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

            if (value_object.usd !== undefined) {
                prices[networkName][price_index] = value_object.usd
            }
        });
    }


    for (const deposited_event of deposited_events) {
        let token1 = deposited_event.returnValues["token1"];

        if (token1 === VETH) {
            token1 = WETH;
        }

        deposited_event.returnValues["price"] = prices[networkName][token1.toLowerCase()];
    }


    if (deposited_events.length !== 0) {
        let placeholders = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        let sql = `INSERT INTO deposits (deposit_id, token0, token1, amount0, amount1, depositor, deposit_price, tracking_price, profit_taking, stop_loss, network_name, dex_name, bot, contract, old) VALUES ` + placeholders + ";";

        for (const deposited_event of deposited_events) {

            let flat_array = [];

            const profit_taking = deposited_event.returnValues["profit_taking"];
            const stop_loss = deposited_event.returnValues["stop_loss"];
            const insert_profit_taking = Number(profit_taking) + Number(SLIPPAGE);
            const insert_stop_loss = Number(stop_loss) > Number(SLIPPAGE) ? Number(stop_loss) - Number(SLIPPAGE) : 0;
            flat_array.push(deposited_event.returnValues["deposit_id"]);
            flat_array.push(deposited_event.returnValues["token0"]);
            flat_array.push(deposited_event.returnValues["token1"]);
            flat_array.push(deposited_event.returnValues["amount0"]);
            flat_array.push(deposited_event.returnValues["amount1"]);
            flat_array.push(deposited_event.returnValues["depositor"]);
            flat_array.push(deposited_event.returnValues["price"]);
            flat_array.push(deposited_event.returnValues["price"]);
            flat_array.push(insert_profit_taking);
            flat_array.push(insert_stop_loss);
            flat_array.push(networkName);
            flat_array.push(DEX);
            flat_array.push(BOT);
            flat_array.push(ADDRESS);
            flat_array.push(OLD);

            try {
                await db.runAsync(sql, flat_array);

                mixpanel.track('bot-add', {
                    bot: BOT,
                    dex: DEX,
                    network: networkName,
                    price: deposited_event.returnValues["price"]
                });
            } catch (e) {
                console.log(e);
            }

        }
    }

    if (withdrawn_events.length !== 0) {
        let sql = `UPDATE deposits SET withdraw_block = ?, withdrawer = ?, withdraw_type = ?, withdraw_amount = ? WHERE deposit_id = ? AND network_name = ? AND bot = ? AND contract = ?;`;
        for (const withdrawn_event of withdrawn_events) {
            let data = [
                withdrawn_event.blockNumber,
                withdrawn_event.returnValues["withdrawer"],
                withdrawn_event.returnValues["withdraw_type"],
                withdrawn_event.returnValues["withdraw_amount"],
                withdrawn_event.returnValues["deposit_id"],
                networkName,
                BOT,
                ADDRESS
            ];
            await db.runAsync(sql, data);

            try {
                const botInfo = await getBot(withdrawn_event.returnValues["deposit_id"]);
                const tokenName = await getBotName(botInfo['token1']);
                const withdrawType = withdrawn_event.returnValues["withdraw_type"];
                if (botInfo && withdrawType !== 'CANCEL') {
                    axios.get(TELEGRAM_ALERT_API, {
                        params: {
                            depositor: botInfo["depositor"],
                            kind: withdrawType === 'EXPIRE' ? WithdrawType.EXPIRED : WithdrawType.SUCCESS,
                            tokenName: tokenName,
                            botType: BOT_NAME,
                        },
                    });
                }
            } catch (error) {
                console.log('Telegram alert error', error);
            }
        }
    }

    if (fromBlock < block_number) {
        let sql = `UPDATE fetched_blocks SET block_number = ? WHERE network_name = ? AND dex = ? AND bot = ? AND contract_instance = ?;`;
        let data = [block_number, networkName, DEX, BOT, ADDRESS];
        await db.runAsync(sql, data);
    }

    const deposits = await getPendingDeposits();
    const withdrawDeposits = [];

    responses = [];

    for (const deposit of deposits) {
        if (deposit.network_name == networkName) {
            let token1 = deposit.token1;
            if (token1 === VETH) {
                token1 = WETH;
            }
            if (prices[networkName][token1.toLowerCase()] === undefined) {
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

            if (value_object.usd !== undefined) {
                prices[networkName][price_index] = value_object.usd
            }
        });
    }

    for (const deposit of deposits) {
        try {
            let withdrawDeposit = null;
            if (deposit.network_name == networkName) {
                withdrawDeposit = await processDeposit(deposit);
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
}

async function getMinAmount(depositor, deposit_id) {
    let amount = 0;
    try {
        amount = await contractInstance.methods.cancel(deposit_id, 0).call({ from: depositor });
    } catch (e) {
        console.log('getMinAmount exception:', e);
    }

    return web3.utils.toBN(amount).mul(web3.utils.toBN(Number(DENOMINATOR) - Number(SLIPPAGE))).div(web3.utils.toBN(DENOMINATOR)).toString();
}


async function processDeposit(deposit) {
    let token1 = deposit.token1;
    if (token1 === VETH) {
        token1 = WETH;
    }

    let price = prices[networkName][token1.toLowerCase()];

    await updatePrice(deposit.id, price);

    if (Number(price) > Number(deposit.deposit_price) * (Number(deposit.profit_taking) + Number(DENOMINATOR)) / Number(DENOMINATOR)) {
        return { "deposit_id": Number(deposit.deposit_id), "withdraw_type": PROFIT_TAKING };
    }

    return null;
}

async function executeWithdraw(deposits) {
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
        { "put_withdraw": { "deposits": deposits } }
    );

    let result = null;

    try {
        const tx = await wallet.createAndSignTx({ msgs: [msg] });
        result = await lcd.tx.broadcast(tx);
    } catch (e) {
        console.log(e);
    }

    return result;
}

async function getBot(deposit_id) {
    const sql = `
        SELECT depositor, token1 FROM deposits
        WHERE deposit_id = ? AND contract = ?;
      `;

    const row = await db.getAsync(sql, [deposit_id, ADDRESS]);

    return row;
}

async function getBotName(tokenAddress) {
    let coinInfo = null;

    for (const geckoToken of geckoTokens) {
        if (tokenAddress.toLowerCase() !== VETH.toLowerCase()) {
            Object.values(geckoToken.platforms).forEach(prop => {
                try {
                    if (prop.toLowerCase() == tokenAddress.toLowerCase()) {
                        coinInfo = geckoToken;
                        //break;
                    }
                } catch (e) {

                }
            });
        } else {
            if (geckoToken.id == "ethereum") {
                coinInfo = geckoToken;
            }
        }

        if (coinInfo) { break; }
    }

    return coinInfo ? coinInfo['name'] : null;
}

async function updatePrice(id, price) {
    await db.runAsync(
        `UPDATE deposits SET tracking_price = ? WHERE id = ? ;`,
        [price, id], null
    );
}

function processDeposits() {
    setInterval(getLastBlock, 1000 * 1);
}

async function getPendingDeposits() {
    let dbAll = promisify(db.all).bind(db);
    let dex = DEX;
    let bot = BOT;
    let nn = networkName;
    let contract = ADDRESS;

    try {
        let rows;
        let query = `SELECT * FROM deposits WHERE withdraw_block IS NULL`;

        query += ` AND LOWER(network_name) = LOWER(?)`;
        query += ` AND LOWER(dex_name) = LOWER(?)`;
        query += ` AND LOWER(bot) = LOWER(?)`;
        query += ` AND LOWER(contract) = LOWER(?);`


        rows = await dbAll(query, nn, dex, bot, contract);

        return rows;
    } catch (err) {
        console.error(err.message);
    }
}


module.exports = {
    processDeposits,
};
