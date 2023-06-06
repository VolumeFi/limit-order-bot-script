const Sentry = require('@sentry/node');
const express = require('express');
<<<<<<< Updated upstream
const { getPendingDeposits, processDeposits} = require('./limit-orders');
=======
const { getAllDeposits, processDeposits, getCoinInfo} = require('./limit-orders');
>>>>>>> Stashed changes

require('dotenv').config();

//Sentry.init({ dsn: process.env.SENTRY });

processDeposits();


const app = express();

app.get('/', (req, res) => {
    res.send('Service is running!');
});

async function convert(deposit) {
    let result = {};

    for (let key in deposit) {
        if (deposit[key] !== null) {
            result[key] = String(deposit[key]);
        }
    }

    let coin_info = await getCoinInfo(deposit.token1);

    result[coin_info] = coin_info;
    return result;
}

app.get('/robots', async (req, res) => {
    try {
        let depositor = req.query.depositor || null;
        let deposits = await getPendingDeposits(depositor);
        let result = [];

        for (const deposit of deposits) {
<<<<<<< Updated upstream
            result.push(convert(deposit));
=======
            if(deposit.withdraw_block === null) {
                result.push(await convert(deposit));
            }
>>>>>>> Stashed changes
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

