const Web3 = require("web3");
const sqlite3 = require("sqlite3").verbose();
const LCDClient = require('@palomachain/paloma.js').LCDClient;
const MsgExecuteContract = require('@palomachain/paloma.js').MsgExecuteContract;
const MnemonicKey = require('@palomachain/paloma.js').MnemonicKey;
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
const WBNB = process.env.WETH;
const SLIPPAGE = process.env.SLIPPAGE;
const DENOMINATOR = 10000;

// Fetch all deposited order.
// Fetch all withdrawn/canceled order.
// Find pending orders from above.
// Find pools list to fetch information.
// Fetch all pool information from Uniswap V3.
// Find executable IDs.

const web3 = new Web3(BNB_NODE);
const contractInstance = new web3.eth.Contract(LOB_ABI, LOB_VYPER);

// deposit_id: uint256
// token0: address
// token1: address
// amount0: uint256
// amount1_min: uint256
// amount1_max: uint256
// depositor: address

let db = new sqlite3.Database("./events.db");
db.serialize(() => {
    let sql = `CREATE TABLE IF NOT EXISTS fetched_blocks (ID INTEGER PRIMARY KEY AUTOINCREMENT, block_number INTEGER);`;
    db.run(sql);
    sql = `CREATE TABLE IF NOT EXISTS deposits (ID INTEGER PRIMARY KEY AUTOINCREMENT, deposit_id INTEGER, token0 TEXT, token1 TEXT, amount0 TEXT, amount1_min TEXT, amount1_max TEXT, pool TEXT, depositor TEXT, profit_taking_or_stop_loss NUMERIC, withdraw_block INTEGER, withdrawer TEXT);`;
    db.run(sql);
    sql = `SELECT * FROM fetched_blocks WHERE ID = (SELECT MAX(ID) FROM fetched_blocks)`;
    let fromBlock = 0;
    db.get(sql, (err, row) => {
        if (row == undefined) {
            sql = `INSERT INTO fetched_blocks (block_number) VALUES (?);`;
            data = [FROM_BLOCK - 1];
            db.run(sql, data);
            fromBlock = Number(FROM_BLOCK);
        } else {
            fromBlock = row["block_number"] + 1;
        }
        main(fromBlock);
    });
});

async function main(fromBlock) {
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
    db.close();
}

async function getDepositIds(row) {
    let calls = [];
    let pools = [];

    for (let key in row) {
        if (!pools.includes(row[key].pool)) {
            let poolInstance = new web3.eth.Contract(POOL_ABI, row[key].pool);
            calls.push(poolInstance.methods.getReserves().call());
            pools.push(row[key].pool);
        }
    }

    const responses = await Promise.all(calls);
    let ids = [];
    let profit_taking_or_stop_loss = [];
    let reserves = [];
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
        if (amount1.gte(amount1_max)) {
            ids.push(row[key].deposit_id);
            profit_taking_or_stop_loss.push(true);
        } else if (amount1.lte(amount1_min)) {
            ids.push(row[key].deposit_id);
            profit_taking_or_stop_loss.push(false);
        }
    }
    if (ids.length() > 0) {
        executeWithdraw(ids, profit_taking_or_stop_loss);
    }
}

async function executeWithdraw(depositIds, profit_taking_or_stop_loss) {
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
        { "put_withdraw": { "deposit_ids": depositIds, "profit_taking_or_stop_loss": profit_taking_or_stop_loss } }
    );

    const tx = await wallet.createAndSignTx({ msgs: [msg] });
    const result = await lcd.tx.broadcast(tx);
    return result;
}
