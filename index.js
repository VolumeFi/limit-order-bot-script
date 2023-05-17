const Sentry = require('@sentry/node');
const express = require('express');
const { getAllDeposits, processDeposits} = require('./limit-orders');

require('dotenv').config();

//Sentry.init({ dsn: process.env.SENTRY });

processDeposits();


const app = express();

app.get('/', (req, res) => {
    res.send('Service is running!');
});

function convert(deposit) {
    let amount0 = BigInt(deposit.amount0);
    let amount1 = BigInt(deposit.amount1);
    let amount1_min = BigInt(deposit.amount1_min);
    let amount1_max = BigInt(deposit.amount1_max);

    return {
        "token0": deposit.token0,
        "token1": deposit.token1,
        "stop_loss": amount1_min / amount0,
        "profit_taking": amount1_max / amount0,
        "depositor": deposit.depositor,
        "current_price": amount1 / amount0
    };
}

app.get('/robots', async (req, res) => {
    try {
        let depositor = req.query.depositor || null;
        let deposits = await getAllDeposits(depositor);
        let result = [];

        deposits.forEach(deposit => {
            result.push(convert(deposit));
        });

        res.json(result);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`Check status on port ${port}`);
});

