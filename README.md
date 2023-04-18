# Script to run Limit Order Bot on Paloma

## Dependencies

```sh
pip install -r requirements.txt
```

## limit_order_bot_init.py

The script to instantiate limit order bot cosmwasm smart contract.

## limit_order_bot_execute.py

The script to get deposit id array from Vyper smart contract and run multiple withdraw function in cosmwasm smart contract on Paloma. This should be run periodically.