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
    if (deposit.withdraw_amount) {
        return {
            "amount0": deposit.amount0.toString(),
            "amount1": deposit.amount1.toString(),
            "token0": deposit.token0.toString(),
            "token1": deposit.token1.toString(),
            "stop_loss": deposit.stop_loss.toString(),
            "profit_taking": deposit.profit_taking.toString(),
            "depositor": deposit.depositor.toString(),
            "withdraw_amount": deposit.withdraw_amount.toString(),
        };
    } else {
        return {
            "amount0": deposit.amount0.toString(),
            "amount1": deposit.amount1.toString(),
            "token0": deposit.token0.toString(),
            "token1": deposit.token1.toString(),
            "stop_loss": deposit.stop_loss.toString(),
            "profit_taking": deposit.profit_taking.toString(),
            "depositor": deposit.depositor.toString(),
            "current_price": deposit.tracking_price.toString()
        };
    }
}

app.get('/robots', async (req, res) => {
    try {
        let depositor = req.query.depositor || null;
        let deposits = await getAllDeposits(depositor);
        let result = [];

        for (const deposit of deposits) {
            if(deposit.withdraw_block === null) {
                result.push(convert(deposit));
            }
        }

        res.json(result);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`Check status on port ${port}`);
});

