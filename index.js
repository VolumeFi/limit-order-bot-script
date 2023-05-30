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
    let result = {};

    for (let key in deposit) {
        if (deposit[key] !== null) {
            result[key] = String(deposit[key]);
        }
    }

    return result;
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

