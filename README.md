# Script to run Limit Order Bot on Paloma

## Dependencies

```sh
pip install -r requirements.txt
```

## initialize.py

The script to instantiate limit order bot cosmwasm smart contract.

## execute.js

The script to get deposit id array from events in Vyper smart contract, caching them in SQLite DB, and run multiple withdraw function in cosmwasm smart contract on Paloma. This should be run periodically.